/*!
 * Copyright 2021 Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { Branch, ControlSignal, StateMachineController, StepFunction } from './stateController'
import * as _ from 'lodash'
import { Prompter, PromptResult } from '../../shared/ui/prompter'
import { PrompterProvider, WizardForm } from './wizardForm'

/** Checks if the user response is valid (i.e. not undefined and not a control signal) */
export function isValidResponse<T>(response: PromptResult<T>): response is T {
    return response !== undefined && !isWizardControl(response)
}

type ObjectKeys<T> = {
    [Property in keyof T]: T[Property] extends Record<string, unknown> ? Property : never
}[keyof T]

type NonObjectKeys<T> = {
    [Property in keyof T]: T[Property] extends Record<string, unknown> ? never : Property
}[keyof T]

/**
 * Reserved type. Currently makes all object-like fields required and everything else
 * optional.
 */
export type WizardState<T> = {
    [Property in ObjectKeys<T>]-?: T[Property] extends Record<string, unknown>
        ? WizardState<Required<T[Property]>>
        : never
} &
    {
        [Property in NonObjectKeys<T>]+?: T[Property] extends Record<string, unknown> ? never : T[Property]
    }

// We use a symbol to safe-guard against collisions (alternatively this can be a class and use 'instanceof')
const WIZARD_CONTROL = Symbol()
const makeControlString = (type: string) => `[WIZARD_CONTROL] ${type}`

export const WIZARD_RETRY = {
    id: WIZARD_CONTROL,
    type: ControlSignal.Retry,
    toString: () => makeControlString('Retry'),
}
export const WIZARD_BACK = { id: WIZARD_CONTROL, type: ControlSignal.Back, toString: () => makeControlString('Back') }
export const WIZARD_EXIT = { id: WIZARD_CONTROL, type: ControlSignal.Exit, toString: () => makeControlString('Exit') }

/** Control signals allow for alterations of the normal wizard flow */
export type WizardControl = typeof WIZARD_RETRY | typeof WIZARD_BACK | typeof WIZARD_EXIT

export function isWizardControl(obj: any): obj is WizardControl {
    return obj !== undefined && obj.id === WIZARD_CONTROL
}

export interface StepEstimator<T> {
    (response: PromptResult<T>): number
}

// Persistent storage that exists on a per-property basis, side effects may occur here
type StepCache = { picked?: any; stepOffset?: [number, number] } & { [key: string]: any }
export type StateWithCache<TState, TProp> = TState & { stepCache: StepCache; estimator: StepEstimator<TProp> }

export interface WizardOptions<TState> {
    readonly initForm?: WizardForm<TState>
    readonly initState?: Partial<TState>
    /** Provides a way to apply inputs to Prompters as if the user has already responded */
    readonly implicitState?: Partial<TState>
    readonly exitPrompterProvider?: (state: TState) => Prompter<boolean>
}

/**
 * A generic wizard that consumes data from a series of {@link Prompter prompters}. The 'form' public property
 * exposes functionality to add prompters to the wizard with optional context, utilizing the {@link WizardForm}
 * class. Wizards will modify a single property of their internal state with each prompt.
 */
export class Wizard<TState extends Partial<Record<keyof TState, unknown>>> {
    private readonly boundSteps: Map<string, StepFunction<TState>> = new Map()
    private readonly _form: WizardForm<TState>
    private stateController: StateMachineController<TState>
    private _stepOffset: [number, number] = [0, 0]
    private _exitStep?: StepFunction<TState>

    /**
     * The offset is applied to both the current step and total number of steps. Useful if the wizard is
     * apart of some overarching flow.
     */
    public set stepOffset(offset: [number, number]) {
        this._stepOffset = offset
    }
    public get currentStep(): number {
        return this._stepOffset[0] + this.stateController.currentStep
    }
    public get totalSteps(): number {
        return this._stepOffset[1] + this.stateController.totalSteps
    }

    public get form() {
        return this._form.body
    }

    /** The internal wizard form with bound prompters. This can be applied to other wizards. */
    public get boundForm() {
        return this._form
    }

    private _estimator: ((state: TState) => number) | undefined
    public set parentEstimator(estimator: (state: TState) => number) {
        this._estimator = estimator
    }

    public constructor(private readonly options: WizardOptions<TState> = {}) {
        this.stateController = new StateMachineController(options.initState as TState)
        this._form = options.initForm ?? new WizardForm()
        this._exitStep =
            options.exitPrompterProvider !== undefined ? this.createExitStep(options.exitPrompterProvider) : undefined
    }

    private assignSteps(): void {
        this._form.properties.forEach(prop => {
            const provider = this._form.getPrompterProvider(prop)
            if (!this.boundSteps.has(prop) && provider !== undefined) {
                this.boundSteps.set(prop, this.createBoundStep(prop, provider))
            }
        })
    }

    public async run(): Promise<TState | undefined> {
        this.assignSteps()
        this.resolveNextSteps((this.options.initState ?? {}) as TState).forEach(step =>
            this.stateController.addStep(step)
        )

        const outputState = await this.stateController.run()

        return outputState !== undefined ? this._form.applyDefaults(outputState) : undefined
    }

    private createStepEstimator<TProp>(state: TState, prop: string): StepEstimator<TProp> {
        state = _.cloneDeep(state)

        return response => {
            if (response !== undefined && !isValidResponse(response)) {
                return 0
            }

            _.set(state, prop, response)
            const estimate = this.resolveNextSteps(state).length
            const parentEstimate = this._estimator !== undefined ? this._estimator(state) : 0
            _.set(state, prop, undefined)

            return estimate + parentEstimate
        }
    }

    private createExitStep(provider: NonNullable<WizardOptions<TState>['exitPrompterProvider']>): StepFunction<TState> {
        return async state => {
            const prompter = provider(state)
            prompter.setSteps(this.currentStep, this.totalSteps)
            const didExit = await prompter.prompt()

            return {
                nextState: state,
                controlSignal: didExit ? ControlSignal.Exit : ControlSignal.Back,
            }
        }
    }

    private createBoundStep<TProp>(prop: string, provider: PrompterProvider<TState, TProp>): StepFunction<TState> {
        const stepCache: StepCache = {}

        return async state => {
            const stateWithCache = Object.assign(
                { stepCache: stepCache, estimator: this.createStepEstimator(state, prop) },
                this._form.applyDefaults(state)
            )
            const impliedResponse = _.get(this.options.implicitState ?? {}, prop)
            const response = await this.promptUser(stateWithCache, provider, impliedResponse)

            if (response === WIZARD_EXIT && this._exitStep !== undefined) {
                return {
                    nextState: state,
                    nextSteps: [this._exitStep],
                }
            }

            return {
                nextState: isValidResponse(response) ? _.set(state, prop, response) : state,
                nextSteps: this.resolveNextSteps(state),
                controlSignal: isWizardControl(response) ? response.type : undefined,
            }
        }
    }

    protected resolveNextSteps(state: TState): Branch<TState> {
        const nextSteps: Branch<TState> = []
        const defaultState = this._form.applyDefaults(state)
        this.boundSteps.forEach((step, targetProp) => {
            if (
                this._form.canShowProperty(targetProp, state, defaultState) &&
                !this.stateController.containsStep(step)
            ) {
                nextSteps.push(step)
            }
        })
        return nextSteps
    }

    private async promptUser<TProp>(
        state: StateWithCache<TState, TProp>,
        provider: PrompterProvider<TState, TProp>,
        impliedResponse?: TProp
    ): Promise<PromptResult<TProp>> {
        const prompter = provider(state as StateWithCache<WizardState<TState>, TProp>)

        this._stepOffset = state.stepCache.stepOffset ?? this._stepOffset
        state.stepCache.stepOffset = this._stepOffset
        prompter.setSteps(this.currentStep, this.totalSteps)
        prompter.setStepEstimator(state.estimator)

        if (state.stepCache.picked !== undefined) {
            prompter.recentItem = state.stepCache.picked
        } else if (impliedResponse !== undefined) {
            prompter.recentItem = impliedResponse
        }

        const answer = await prompter.prompt()

        if (isValidResponse(answer)) {
            state.stepCache.picked = prompter.recentItem
        }

        if (!isValidResponse(answer)) {
            delete state.stepCache.stepOffset
        }

        this._stepOffset = [
            this._stepOffset[0] + prompter.totalSteps - 1,
            this._stepOffset[1] + prompter.totalSteps - 1,
        ]

        // Legacy code used 'undefined' to represent back, we will support the use-case
        // but moving forward wizard implementations will explicity use 'WIZARD_BACK'
        return answer ?? WIZARD_BACK
    }
}
