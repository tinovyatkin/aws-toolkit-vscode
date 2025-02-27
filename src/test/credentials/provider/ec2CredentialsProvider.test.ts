/*!
 * Copyright 2021 Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import * as assert from 'assert'
import { Ec2MetadataClient, IamInfo, InstanceIdentity } from '../../../shared/clients/ec2MetadataClient'
import { Ec2CredentialsProvider } from '../../../credentials/providers/ec2CredentialsProvider'
import { instance, mock, verify, when } from '../../utilities/mockito'

describe('Ec2CredentialsProvider', function () {
    const dummyRegion = 'dummmyRegion'

    const mockIdentity = {
        region: dummyRegion,
    } as InstanceIdentity

    let mockMetadata: Ec2MetadataClient
    let credentialsProvider: Ec2CredentialsProvider

    beforeEach(function () {
        mockMetadata = mock()
        credentialsProvider = new Ec2CredentialsProvider(instance(mockMetadata))
    })

    it('is valid if EC2 metadata service resolves valid IAM status', async function () {
        mockClient({
            identity: {} as InstanceIdentity,
            validIam: true,
        })
        assert.strictEqual(await credentialsProvider.isAvailable(), true)
    })

    it('is invalid if EC2 metadata resolves invalid IAM status', async function () {
        mockClient({
            validIam: false,
        })
        assert.strictEqual(await credentialsProvider.isAvailable(), false)
    })

    it('is invalid if EC2 metadata service fails to resolve', async function () {
        mockClient({
            fail: true,
        })
        assert.strictEqual(await credentialsProvider.isAvailable(), false)
    })

    it('only validates once per instance', async function () {
        mockClient({
            identity: mockIdentity,
            validIam: true,
        })
        try {
            await credentialsProvider.isAvailable()
            await credentialsProvider.isAvailable()
            verify(mockMetadata.getIamInfo()).once()
        } catch (err) {}
    })

    it('returns EC2 retrieved region if available', async function () {
        mockClient({
            identity: mockIdentity,
            validIam: true,
        })

        await credentialsProvider.isAvailable()
        assert.strictEqual(credentialsProvider.getDefaultRegion(), dummyRegion)
    })

    it('returns undefined region when not available', async function () {
        mockClient({
            identity: {} as InstanceIdentity,
            validIam: true,
        })

        await credentialsProvider.isAvailable()
        assert.strictEqual(credentialsProvider.getDefaultRegion(), undefined)
    })

    function mockClient(opts: { fail?: boolean; identity?: InstanceIdentity; validIam?: boolean }) {
        if (opts.fail) {
            when(mockMetadata.getInstanceIdentity()).thenReject(new Error('foo'))
        } else if (opts.identity) {
            when(mockMetadata.getInstanceIdentity()).thenResolve(opts.identity)
        }

        const mockIamInfo = {
            Code: opts.validIam ? 'Success' : 'Failure',
        } as IamInfo
        when(mockMetadata.getIamInfo()).thenResolve(mockIamInfo)
    }
})
