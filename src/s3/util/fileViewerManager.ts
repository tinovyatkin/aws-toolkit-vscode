/*!
 * Copyright 2021 Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { ext } from '../../shared/extensionGlobals'
import { S3FileNode } from '../explorer/s3FileNode'
import { Window } from '../../shared/vscode/window'
import { showOutputMessage } from '../../shared/utilities/messages'
import { makeTemporaryToolkitFolder } from '../../shared/filesystemUtilities'
import { OutputChannel } from 'vscode'
export class FileViewerManager {
    //private cache: Set<S3FileNode>
    //private activeTabs: Set<S3Tab>
    //private window: Window
    private outputChannel: OutputChannel
    private tempLocation: string | undefined

    public constructor(window: Window = Window.vscode(), outputChannel = ext.outputChannel) {
        //this.cache = new Set<S3FileNode>()
        //this.activeTabs = new Set<S3Tab>()
        //this.window = window
        this.outputChannel = outputChannel
        this.createTemp()
        showOutputMessage('initializing manager', outputChannel)
    }

    public async openTab(fileNode: S3FileNode, outputChannel = ext.outputChannel): Promise<void> {
        showOutputMessage(`     manager initialized, file: ${fileNode.file.key}`, this.outputChannel)
    }

    public async createTemp() {
        this.tempLocation = await makeTemporaryToolkitFolder()
        showOutputMessage(`temp created, temp: ${this.tempLocation}`, this.outputChannel)
    }

    public async storeInTemp() {}
}

export class SingletonManager {
    static fileManager: FileViewerManager | undefined

    private constructor() {}

    public static getInstance(): FileViewerManager {
        if (!SingletonManager.fileManager) {
            SingletonManager.fileManager = new FileViewerManager()
        }
        return SingletonManager.fileManager
    }
}
