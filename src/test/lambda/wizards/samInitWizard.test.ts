/*!
 * Copyright 2018-2019 Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { eventBridgeStarterAppTemplate } from '../../../lambda/models/samTemplates'
import { CreateNewSamAppWizard, CreateNewSamAppWizardForm } from '../../../lambda/wizards/samInitWizard'
import { createWizardTester, WizardTester } from '../../shared/wizards/wizardTestUtils'

describe('CreateNewSamAppWizard', async function () {
    let tester: WizardTester<CreateNewSamAppWizardForm>

    beforeEach(function () {
        tester = createWizardTester(new CreateNewSamAppWizard({ samCliVersion: '', schemasRegions: [] }))
    })

    it('prompts for runtime first', function () {
        tester.runtimeAndPackage.assertShowFirst()
    })

    it('always prompts for at least 4 things', function () {
        tester.assertShowCount(4)
    })

    it('prompts for dependency manager if there are multiple', function () {
        tester.dependencyManager.assertDoesNotShow()
        tester.runtimeAndPackage.applyInput({ runtime: 'java11', packageType: 'Zip' })
        tester.dependencyManager.assertShow()
    })

    it('always prompts for template after runtime and dependency manager', function () {
        tester.template.assertShowSecond()
        tester.runtimeAndPackage.applyInput({ runtime: 'java11', packageType: 'Zip' })
        tester.template.assertShowSecond()
    })

    it('prompts for schema configuration if a schema template is selected', function () {
        tester.runtimeAndPackage.applyInput({ runtime: 'nodejs14.x', packageType: 'Zip' })
        tester.template.applyInput(eventBridgeStarterAppTemplate)
        tester.region.assertShowFirst()
        tester.registryName.assertShowSecond()
        tester.schemaName.assertShowThird()
    })
})
