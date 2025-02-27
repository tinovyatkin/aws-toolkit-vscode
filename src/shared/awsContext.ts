/*!
 * Copyright 2018-2019 Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import * as vscode from 'vscode'
import * as AWS from '@aws-sdk/types'
import { regionSettingKey } from './constants'
import { getLogger } from '../shared/logger'
import { ClassToInterfaceType } from './utilities/tsUtils'

export interface AwsContextCredentials {
    readonly credentials: AWS.Credentials
    readonly credentialsId: string
    readonly accountId?: string
    readonly defaultRegion?: string
}

// Carries the current context data on events
export interface ContextChangeEventsArgs {
    readonly profileName?: string
    readonly accountId?: string
    readonly developerMode: Set<string>
}

// Represents a credential profile and zero or more regions.
export type AwsContext = ClassToInterfaceType<DefaultAwsContext>

export class NoActiveCredentialError extends Error {
    public message = 'No AWS profile selected'
}

const logged = new Set<string>()
const DEFAULT_REGION = 'us-east-1'

/**
 * Wraps an AWS context in terms of credential profile and zero or more regions. The
 * context listens for configuration updates and resets the context accordingly.
 */
export class DefaultAwsContext implements AwsContext {
    public readonly onDidChangeContext: vscode.Event<ContextChangeEventsArgs>
    private readonly _onDidChangeContext: vscode.EventEmitter<ContextChangeEventsArgs>

    // the collection of regions the user has expressed an interest in working with in
    // the current workspace
    private readonly explorerRegions: string[]

    private currentCredentials: AwsContextCredentials | undefined
    private developerMode = new Set<string>()

    public constructor(private context: vscode.ExtensionContext) {
        this._onDidChangeContext = new vscode.EventEmitter<ContextChangeEventsArgs>()
        this.onDidChangeContext = this._onDidChangeContext.event

        const persistedRegions = context.globalState.get<string[]>(regionSettingKey)
        this.explorerRegions = persistedRegions || []
    }

    /**
     * Sets the credentials to be used by the Toolkit.
     * Passing in undefined represents that there are no active credentials.
     */
    public async setCredentials(credentials?: AwsContextCredentials): Promise<void> {
        if (JSON.stringify(this.currentCredentials) === JSON.stringify(credentials)) {
            // Do nothing. Besides performance, this avoids infinite loops.
            return
        }
        this.currentCredentials = credentials
        this.emitEvent()
    }

    /**
     * Sets "developer mode" when a Toolkit developer setting is active.
     *
     * @param enable  Set "developer mode" as enabled or disabled
     * @param settingName  Name of the detected setting, or undefined for `enable=false`.
     */
    public async setDeveloperMode(enable: boolean, settingName: string | undefined): Promise<void> {
        const enabled = this.developerMode.size > 0
        if (enable === enabled && (!enable || this.developerMode.has(settingName ?? '?'))) {
            // Do nothing. Besides performance, this avoids infinite loops.
            return
        }

        if (!enable) {
            this.developerMode.clear()
        } else {
            this.developerMode.add(settingName ?? '?')
        }
        this.emitEvent()
    }

    /**
     * @description Gets the Credentials currently used by the Toolkit.
     */
    public async getCredentials(): Promise<AWS.Credentials | undefined> {
        return this.currentCredentials?.credentials
    }

    // returns the configured profile, if any
    public getCredentialProfileName(): string | undefined {
        return this.currentCredentials?.credentialsId
    }

    // returns the configured profile's account ID, if any
    public getCredentialAccountId(): string | undefined {
        return this.currentCredentials?.accountId
    }

    public getCredentialDefaultRegion(): string {
        const credId = this.currentCredentials?.credentialsId ?? ''
        if (!logged.has(credId) && !this.currentCredentials?.defaultRegion) {
            logged.add(credId)
            getLogger().warn(
                `AwsContext: no default region in credentials profile, falling back to ${DEFAULT_REGION}: ${credId}`
            )
        }

        return this.currentCredentials?.defaultRegion ?? DEFAULT_REGION
    }

    // async so that we could *potentially* support other ways of obtaining
    // region in future - for example from instance metadata if the
    // user was running Code on an EC2 instance.
    public async getExplorerRegions(): Promise<string[]> {
        return this.explorerRegions
    }

    // adds one or more regions into the preferred set, persisting the set afterwards as a
    // comma-separated string.
    public async addExplorerRegion(...regions: string[]): Promise<void> {
        regions.forEach(r => {
            const index = this.explorerRegions.findIndex(regionToProcess => regionToProcess === r)
            if (index === -1) {
                this.explorerRegions.push(r)
            }
        })
        await this.context.globalState.update(regionSettingKey, this.explorerRegions)
    }

    // removes one or more regions from the user's preferred set, persisting the set afterwards as a
    // comma-separated string.
    public async removeExplorerRegion(...regions: string[]): Promise<void> {
        regions.forEach(r => {
            const index = this.explorerRegions.findIndex(explorerRegion => explorerRegion === r)
            if (index >= 0) {
                this.explorerRegions.splice(index, 1)
            }
        })

        await this.context.globalState.update(regionSettingKey, this.explorerRegions)
    }

    private emitEvent() {
        // TODO(jmkeyes): skip this if the state did not actually change.
        this._onDidChangeContext.fire({
            profileName: this.currentCredentials?.credentialsId,
            accountId: this.currentCredentials?.accountId,
            developerMode: this.developerMode,
        })
    }
}
