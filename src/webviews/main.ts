/*!
 * Copyright 2021 Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import * as path from 'path'
import * as vscode from 'vscode'
import { ExtensionUtilities, isCloud9 } from '../shared/extensionUtilities'

interface WebviewParams<TRequest, TResponse> {
    id: string
    name: string
    webviewJs: string
    context: vscode.ExtensionContext
    /** Initial calls are posted whenever the webview is regenerated (e.g. the webview was moved to another panel) */
    initialCalls?: TResponse[]
    persistSessions?: boolean
    persistWithoutFocus?: boolean
    cssFiles?: string[]
    jsFiles?: string[]
    libFiles?: string[]
    onDidReceiveMessageFunction(
        request: TRequest,
        postMessageFn: (response: TResponse) => Thenable<boolean>,
        destroyWebviewFn: () => any
    ): void
    onDidDisposeFunction?(): void
}

export async function createVueWebview<TRequest, TResponse>(params: WebviewParams<TRequest, TResponse>) {
    const libsPath: string = path.join(params.context.extensionPath, 'media', 'libs')
    const jsPath: string = path.join(params.context.extensionPath, 'media', 'js')
    const cssPath: string = path.join(params.context.extensionPath, 'media', 'css')
    const webviewPath: string = path.join(params.context.extensionPath, 'dist')
    const resourcesPath: string = path.join(params.context.extensionPath, 'resources')

    const view = vscode.window.createWebviewPanel(
        params.id,
        params.name,
        // Cloud9 opens the webview in the bottom pane unless a second pane already exists on the main level.
        isCloud9() ? vscode.ViewColumn.Two : vscode.ViewColumn.Beside,
        {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.file(libsPath),
                vscode.Uri.file(jsPath),
                vscode.Uri.file(cssPath),
                vscode.Uri.file(webviewPath),
                vscode.Uri.file(resourcesPath),
            ],
            // HACK: Cloud9 does not have get/setState support. Remove when it does.
            retainContextWhenHidden: isCloud9() ? true : params.persistWithoutFocus,
        }
    )

    const loadLibs = ExtensionUtilities.getFilesAsVsCodeResources(
        libsPath,
        ['vue.min.js', ...(params.libFiles ?? [])],
        view.webview
    ).concat(
        ExtensionUtilities.getFilesAsVsCodeResources(
            jsPath,
            ['loadVsCodeApi.js', ...(params.jsFiles ?? [])],
            view.webview
        )
    )

    const loadCss = ExtensionUtilities.getFilesAsVsCodeResources(cssPath, [...(params.cssFiles ?? [])], view.webview)

    let scripts: string = ''
    let stylesheets: string = ''

    loadLibs.forEach(element => {
        scripts = scripts.concat(`<script src="${element}"></script>\n\n`)
    })

    loadCss.forEach(element => {
        stylesheets = stylesheets.concat(`<link rel="stylesheet" href="${element}">\n\n`)
    })

    const mainScript: vscode.Uri = view.webview.asWebviewUri(vscode.Uri.file(path.join(webviewPath, params.webviewJs)))

    view.title = params.name
    view.webview.html = `<html>
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        
        <meta
            http-equiv="Content-Security-Policy"
            content=
                "default-src 'none';
                img-src ${view.webview.cspSource} https:;
                script-src ${view.webview.cspSource};
                style-src ${view.webview.cspSource} 'unsafe-inline';
                font-src 'self' data:;"
        >
    </head>
    <body>
        <div id="vue-app"></div>
        <!-- Dependencies -->
        ${scripts}
        ${stylesheets}
        <!-- Main -->
        <script src="${mainScript}"></script>
    </body>
</html>`

    if (params.initialCalls) {
        view.webview.onDidReceiveMessage((message: any) => {
            if (message.command === 'initialized') {
                for (const call of params.initialCalls!) view.webview.postMessage(call)
            }
        })
    }

    view.webview.onDidReceiveMessage(
        // type the any if necessary
        (message: any) => {
            params.onDidReceiveMessageFunction(
                message,
                response => view.webview.postMessage(response),
                // tslint:disable-next-line: no-unsafe-any
                () => view.dispose()
            )
        },
        undefined,
        params.context.subscriptions
    )

    view.onDidDispose(
        () => {
            if (params.onDidDisposeFunction) {
                params.onDidDisposeFunction()
            }
        },
        undefined,
        params.context.subscriptions
    )
}
