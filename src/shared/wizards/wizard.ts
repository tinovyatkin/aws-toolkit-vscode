/*!
 * Copyright 2021 Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { StateBranch, StateMachineController, StateStepFunction } from './stateController'
import * as vscode from 'vscode'
import * as _ from 'lodash'
import { Prompter } from '../../shared/ui/prompter'

type QuickInputTypes<T> = string | T | T[] | WizardControl | undefined

interface PropertyOptions<TState, TProp> {
    /**
     * Applies a conditional function that is evaluated after every user-input if the property
     * is undefined or if the property is not queued up to be prompted. Upon returning true, the 
     * bound property will be added to the prompt queue.
     */
    showWhen?: (state: WizardSchema<TState>) => boolean
    /**
     * Sets a default value for the response form if it is undefined after the wizard terminates.
     */
    setDefault?: (state: WizardSchema<TState>) => TProp | undefined
    /**
     * Automatically assigns the property if only a single option is available. This happens before
     * the step is added to the wizard, decreasing the total number of steps.
     */
    //autoSelect?: boolean (not implemented)

    before?: (state: WizardSchema<TState>) => Promise<WizardControl | undefined>
}

export type WizardQuickPickItem<T> =  T extends string 
    ? vscode.QuickPickItem & { metadata?: string | symbol | (() => Promise<string | symbol>) }
    : vscode.QuickPickItem & { metadata: T | symbol | (() => Promise<T | symbol>) }

/** Returning this causes the wizard to retry the current step */
//export type WizardControl = typeof WIZARD_RETRY | typeof WIZARD_CHAIN | typeof WIZARD_GOBACK | typeof WIZARD_EXIT

// We use a symbol to safe-guard against collisions
const WIZARD_CONTROL = Symbol()

export enum WizardControlType {
    Back,
    Retry,
    Exit,
    Chain,
}

export function makeWizardChain<T>(data: T): WizardControl<T> {
    return { id: WIZARD_CONTROL, type: WizardControlType.Chain, data: data }
}

export const WIZARD_RETRY: WizardControl = { id: WIZARD_CONTROL, type: WizardControlType.Retry }
export const WIZARD_GOBACK: WizardControl = { id: WIZARD_CONTROL, type: WizardControlType.Back }
export const WIZARD_EXIT: WizardControl = { id: WIZARD_CONTROL, type: WizardControlType.Exit }

export interface WizardControl<T=any> {
    id: typeof WIZARD_CONTROL
    type: WizardControlType
    data?: T // Additional control information for the wizard to react to
}

export function isWizardControl(obj: any): obj is WizardControl {
    return obj !== undefined && obj.id === WIZARD_CONTROL
}

function isWizardRetry<T>(picked: QuickInputTypes<T> | undefined): boolean {
    return picked !== undefined && isWizardControl(picked) && picked.type === WizardControlType.Retry
}

function isWizardChain<T>(picked: QuickInputTypes<T> | undefined): boolean {
    return picked !== undefined && isWizardControl(picked) && picked.type === WizardControlType.Chain
}

function isWizardBack<T>(picked: QuickInputTypes<T> | undefined): boolean {
    return picked !== undefined && isWizardControl(picked) && picked.type === WizardControlType.Back
}

function isWizardExit<T>(picked: QuickInputTypes<T> | undefined): boolean {
    return picked !== undefined && isWizardControl(picked) && picked.type === WizardControlType.Exit
}

function nullChildren(obj: any): boolean {
    return typeof obj === 'object' && Object.keys(obj).every(key => obj[key] === undefined)
}

type PrompterBind<TProp, TState> = (getPrompter: (state: WizardSchema<TState> & { stepCache: StepCache }) => 
    Prompter<TProp>, options?: PropertyOptions<TState, TProp>) => WizardChainElement<TProp, TState>

type ChainPrompterBind<TProp, TState> = (getPrompter: (state: WizardSchema<TState> & { stepCache: StepCache }, response: TProp) => 
    Prompter<TProp>, options?: PropertyOptions<TState, TProp>) => WizardChainElement<TProp, TState>
interface WizardFormElement<TProp, TState> {
    /**
     * TODO: change this so Prompters are not regenerated upon every call (i.e. add update functionality to prompter)
     * Binds a Prompter provider to the specified property. The provider is called whenever the property is ready for 
     * input, and should return a Prompter object.
     */
    readonly bindPrompter: PrompterBind<NonNullable<TProp>, TState>
}

interface WizardChainElement<TProp, TState> {
    readonly chainPrompter: ChainPrompterBind<TProp, TState>
}

/**
 * Transforms an interface into a collection of WizardFormElements
 */
type WizardForm<T, TState=T> = {
    [Property in keyof T]-?: T[Property] extends Record<string, unknown> 
        ? WizardForm<T[Property], TState> & WizardFormElement<T[Property], TState>
        : WizardFormElement<T[Property], TState>
}

type ObjectKeys<T> = {
    [Property in keyof T]: T[Property] extends Record<string, unknown> ? Property : never
}[keyof T]

type NonObjectKeys<T> = {
    [Property in keyof T]: T[Property] extends Record<string, unknown> ? never : Property
}[keyof T]

/**
 * Any property with sub-properties becomes a required element, while everything else
 * becomes optional. This is applied recursively.
 */
export type WizardSchema<T> = {
    [Property in ObjectKeys<T>]-?: T[Property] extends Record<string, unknown> ? 
        WizardSchema<T[Property]> : never
} & {
    [Property in NonObjectKeys<T>]+?: T[Property] extends Record<string, unknown> ? 
        never : T[Property]
}

// Persistent storage that exists on a per-property basis
type StepCache = { [key: string]: any }

type StepWithOptions<TState, TProp> = PropertyOptions<TState, TProp> & { boundStep?: StateStepFunction<TState> }

/**
 * A generic wizard that consumes data from a series of 'prompts'. Wizards will modify a single property of
 * their internal state with each prompt. Classes that extend this base class can assign Prompters to individual
 * properties by using the internal 'form' object. 
 */
export abstract class Wizard<TState extends WizardSchema<TState>, TResult=TState> {
    private readonly formData = new Map<string, { options: StepWithOptions<TState, any>[], step: number }>()
    private currentPromper?: Prompter<any>
    protected readonly form!: WizardForm<TState> 
    private readonly stateController!: StateMachineController<TState>
    private lastResponse: any

    public constructor(private readonly schema: WizardSchema<TState>, initState?: Partial<TState>) {
        this.form = this.createWizardForm(schema)
        this.stateController = new StateMachineController({ ...initState } as TState)
    }

    private applyDefaults(state: TState): TState {
        this.formData.forEach((options, targetProp) => {
            const opt = options.options[options.step]
            const current = _.get(state, targetProp)

            if ((current === undefined || nullChildren(current)) && opt.setDefault !== undefined) {
                _.set(state, targetProp, opt.setDefault(state))
            }
        })

        return state
    }

    public async run(): Promise<TState | TResult | undefined> {
        this.resolveNextSteps(this.schema as any).forEach(step => this.stateController.addStep(step))
        try {
            const outputState = await this.stateController.run()
            // remove cache
            if (outputState !== undefined) {
                delete (outputState as any)['stepCache']
            }
            return outputState ? this.applyDefaults(outputState) : undefined
        } catch (e) {
            if (e.message !== 'exit') {
                throw e
            }
        }
    }

    public getCurrentPrompter(): Prompter<any> | undefined {
        return this.currentPromper
    }

    private createBindPrompterMethod<TProp>(propPath: string[], isChain = false): PrompterBind<TProp, TState> {
        return (
            prompterProvider: (form: TState & { stepCache: StepCache }, lastResponse?: TProp) => Prompter<TProp>, 
            options: PropertyOptions<TState, TProp> = {}
        ) => {
            const prop = propPath.join('.')

            if (this.formData.get(prop) !== undefined && !isChain) {
                throw new Error('Can only bind one prompt per property')
            }

            const stepCache: StepCache = {}
            const boundStep = async (state: TState) => {
                // TODO: move this code somewhere else
                const stateWithCache = Object.assign(state, { stepCache: stepCache })
                if (options.before !== undefined) {
                    await options.before(stateWithCache)
                }

                const response = await this.promptUser(stateWithCache, 
                    prompterProvider(stateWithCache, isChain ? this.lastResponse.data : undefined))

                if (!isWizardControl(response)) {
                    _.set(state, prop, response)
                }

                if (isWizardChain(response)) {
                    this.formData.get(prop)!.step += 1
                    this.lastResponse = response
                } else if (isWizardBack(response) || response === undefined) {
                    const step = this.formData.get(prop)!.step
                    this.formData.get(prop)!.step = Math.max(0, step - 1)
                } else if (isWizardExit(response)) {
                    throw new Error('exit') // wow what a good way to exit
                }
                
                return { 
                    nextState: response !== undefined && !isWizardBack(response) ? state : undefined,
                    nextSteps: response !== undefined ? this.resolveNextSteps(state) : undefined, 
                    repeatStep: isWizardRetry(response)
                }
            }
    
            const last = this.formData.get(propPath.join('.')) ?? { options: [], step: 0 }
            last.options.push({ ...options, boundStep })
            this.formData.set(propPath.join('.'), last)

            // chains
            return { chainPrompter: this.createBindPrompterMethod<TProp>(propPath, true) as ChainPrompterBind<TProp, TState> }
        }
    }

    private createWizardForm(schema: any, path: string[] = []): WizardForm<TState> {
        const form = {}
        
        Object.entries(schema).forEach(([key, value]: [string, unknown]) => {
            const newPath = [...path, key]
            const element = {
                bindPrompter: this.createBindPrompterMethod(newPath),
                ...(typeof value === 'object' ?  this.createWizardForm(value, newPath) : {})
            } as WizardFormElement<any, TState>

            Object.assign(form, { [key]: element })
        })

        return form as WizardForm<TState>
    }

    private resolveNextSteps(state: TState): StateBranch<TState> {
        const nextSteps: StateBranch<TState> = []
        this.formData.forEach((options, targetProp) => {
            const opt = options.options[options.step]
            const current = _.get(state, targetProp)

            if ((current === undefined || nullChildren(current)) &&
                !this.stateController.containsStep(opt.boundStep)
            ) {
                if (opt.showWhen === undefined || opt.showWhen(state) === true) {
                    nextSteps.push(opt.boundStep!)
                }
            }
        })
        return nextSteps
    } 

    private async promptUser<TProp>(
        state: TState & { stepCache: StepCache }, 
        prompter: Prompter<TProp>,
    ): Promise<QuickInputTypes<TProp>> {
        this.currentPromper = prompter
        prompter.setSteps(this.stateController.currentStep, this.stateController.totalSteps)

        if (state.stepCache.picked !== undefined) {
            prompter.setLastPicked(state.stepCache.picked)
        }

        const answer = await prompter.prompt()

        if (answer !== undefined) {
            state.stepCache.picked = prompter.getLastPicked()
        }

        this.currentPromper = undefined

        return answer
    }
}