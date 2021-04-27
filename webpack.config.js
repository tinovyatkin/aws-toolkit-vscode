/*!
 * Copyright 2020 Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

//@ts-check

'use strict'

const path = require('path')
const webpack = require('webpack')
const { ESBuildMinifyPlugin } = require('esbuild-loader')
const { VueLoaderPlugin } = require('vue-loader')
const fs = require('fs')
const { NLSBundlePlugin } = require('vscode-nls-dev/lib/webpack-bundler')
const CircularDependencyPlugin = require('circular-dependency-plugin')
const packageJsonFile = path.join(__dirname, 'package.json')
const packageJson = JSON.parse(fs.readFileSync(packageJsonFile, 'utf8'))
const packageId = `${packageJson.publisher}.${packageJson.name}`

/**@type {import('webpack').Configuration}*/
const baseConfig = {
    name: 'main',
    target: 'node',
    entry: {
        extension: './src/extension.ts',
        'src/stepFunctions/asl/aslServer': './src/stepFunctions/asl/aslServer.ts',
    },
    output: {
        path: path.resolve(__dirname, 'dist'),
        filename: '[name].js',
        libraryTarget: 'commonjs2',
        devtoolModuleFilenameTemplate: '../[resource-path]',
    },
    devtool: 'source-map',
    externals: {
        vscode: 'commonjs vscode',
    },
    resolve: {
        extensions: ['.ts', '.js'],
        alias: {
            handlebars: 'handlebars/dist/handlebars.min.js',
        },
    },
    node: {
        __dirname: false, //preserve the default node.js behavior for __dirname
    },
    module: {
        rules: [
            {
                test: /\.ts$/,
                exclude: /node_modules/,
                use: [
                    {
                        // vscode-nls-dev loader:
                        // * rewrite nls-calls
                        loader: 'vscode-nls-dev/lib/webpack-loader',
                        options: {
                            base: __dirname,
                        },
                    },
                    {
                        loader: 'esbuild-loader',
                        options: {
                            loader: 'ts', // Or 'ts' if you don't need tsx
                            target: 'es2018',
                        },
                    },
                ],
            },
            {
                test: /node_modules[\\|/](amazon-states-language-service)/,
                use: { loader: 'umd-compat-loader' },
            },
        ],
    },
    plugins: [
        new NLSBundlePlugin(packageId),
        new webpack.DefinePlugin({
            PLUGINVERSION: JSON.stringify(packageJson.version),
        }),
        new CircularDependencyPlugin({
            exclude: /node_modules/,
            failOnError: true,
        }),
    ],
    optimization: {
        minimize: true,
        minimizer: [
            new ESBuildMinifyPlugin({
                target: 'es2018',
            }),
        ],
    },
}

/**@type {import('webpack').Configuration}*/
const webviewConfig = {
    name: 'vueLoader',
    entry: {
        samInvokeVue: path.resolve(__dirname, 'src', 'lambda', 'vue', 'samInvokeVue.ts'),
    },
    output: {
        path: path.resolve(__dirname, 'dist', 'compiledWebviews'),
        filename: '[name].js',
    },

    // Enable sourcemaps for debugging webpack's output.
    devtool: 'source-map',

    resolve: {
        // Add '.ts' and '.tsx' as resolvable extensions.
        extensions: ['.ts', '.tsx', '.js', '.json'],
        alias: {
            vue$: require.resolve('vue/dist/vue.esm.js'),
        },
    },
    module: {
        rules: [
            {
                test: /\.tsx?$/,
                loader: 'esbuild-loader',
                options: {
                    loader: 'tsx',
                    target: 'es2018',
                },
                exclude: /node_modules/,
            },
            {
                test: /\.vue$/,
                loader: 'vue-loader',
            },
        ],
    },
    plugins: [new VueLoaderPlugin()],
}

module.exports = [baseConfig, webviewConfig]
