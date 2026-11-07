import { useCallback } from 'react';
import { useCentralStack } from '@cms-core';
import { useHybridflow } from './Hybridflow-ctx';
import {
    instantiationChainOf, latestPublished, readFlowNodeClasses, workflowMembersOf,
} from './flowNodeClass';
import { FlowNodeSpot } from './flowNodeSpot';
import { isTask } from './flowNodeType';
import { versionBodyTemplate } from './flowNodeTemplates';
import { InstantiateBodies, ListedClassDto } from './service';
import { TemplateInstantiationPanel } from './components/TemplateInstantiationPanel';
import { BOARD_TAB_ID } from './constants';

/** The instantiation wizard's entry on the central area's stack. */
export const CLASS_TEMPLATE_INSTANTIATION_PANEL_ID = 'class-template-instantiation';

/** One template the wizard walks: a class's latest published version, in template mode. */
export interface ClassTemplateStep {
    classId: string;
    classTitle: string;
    versionNumber: number;
    body: string;
}

/** The templates an instantiation fills in: the latest published version of the class and each. */
export const templateStepsOf = (
    classes: ListedClassDto[], classId: string,
): ClassTemplateStep[] => instantiationChainOf(readFlowNodeClasses(classes), classId)
    .flatMap(one => {
        const version = latestPublished(one);
        return version && version.template && isTask(one.type)
            ? [{ classId: one.id, classTitle: one.title, versionNumber: version.number, body: version.body }]
            : [];
    });

/** Whether the chain is instantiated as the wizard needs: every class of it holding a published. */
export const chainReadyForTemplates = (
    classes: ListedClassDto[], classId: string,
): boolean => {
    const chain = instantiationChainOf(readFlowNodeClasses(classes), classId);
    return chain.length > 0 && chain.every(one => latestPublished(one) !== null);
};

/** The templates a workflow-class instantiation fills in: the latest published version of each member. */
export const workflowTemplateStepsOf = (
    classes: ListedClassDto[], workflowClassId: string,
): ClassTemplateStep[] => workflowMembersOf(readFlowNodeClasses(classes), workflowClassId)
    .flatMap(one => {
        const version = latestPublished(one);
        return version && version.template && isTask(one.type)
            ? [{ classId: one.id, classTitle: one.title, versionNumber: version.number, body: version.body }]
            : [];
    });

/** Whether the workflow class is instantiated as the wizard needs: holding at least one class, every. */
export const workflowReadyForTemplates = (
    classes: ListedClassDto[], workflowClassId: string,
): boolean => {
    const members = workflowMembersOf(readFlowNodeClasses(classes), workflowClassId);
    return members.length > 0 && members.every(one => latestPublished(one) !== null);
};

/** The wizard itself: one panel per template, in the central area, in the same instantiation panel. */
const useTemplateWizard = () => {
    const { push, close } = useCentralStack();

    return useCallback((steps: ClassTemplateStep[], finish: (bodies: InstantiateBodies) => void) => {
        const pushStep = (index: number, bodies: InstantiateBodies) => {
            const step = steps[index];
            push({
                id: CLASS_TEMPLATE_INSTANTIATION_PANEL_ID,
                host: BOARD_TAB_ID,
                title: `Write “${step.classTitle || 'Untitled'}” v${step.versionNumber} from its template`
                    + ` (${index + 1} of ${steps.length})`,
                closeLabel: 'Cancel',
                content: (
                    <TemplateInstantiationPanel
                        inline={{
                            template: versionBodyTemplate(step.body, step.classTitle),
                            title: step.classTitle,
                        }}
                        onInstantiate={text => {
                            const next = { ...bodies, [step.classId]: text };
                            if (index + 1 < steps.length) pushStep(index + 1, next);
                            else {
                                close(CLASS_TEMPLATE_INSTANTIATION_PANEL_ID);
                                finish(next);
                            }
                        }}
                    />
                ),
            });
        };
        pushStep(0, {});
    }, [push, close]);
};

/** Instantiating a class from the canvas menu: its templates first, its flow nodes after. */
export const useInstantiateClass = (targets: ListedClassDto[]) => {
    const { instantiateFlowNodeClass } = useHybridflow();
    const walk = useTemplateWizard();

    return useCallback((classId: string, spot: FlowNodeSpot, workflow = '') => {
        const steps = templateStepsOf(targets, classId);
        // The rectangle travels only where one was named: a plain instantiation is the same call it always was, down to the arguments.
        const finish = (bodies?: InstantiateBodies) => {
            if (workflow) return instantiateFlowNodeClass(classId, spot, bodies, workflow);
            if (bodies === undefined) return instantiateFlowNodeClass(classId, spot);
            return instantiateFlowNodeClass(classId, spot, bodies);
        };
        if (steps.length === 0 || !chainReadyForTemplates(targets, classId)) {
            finish();
            return;
        }
        walk(steps, finish);
    }, [targets, instantiateFlowNodeClass, walk]);
};

/** Instantiating a workflow class from the canvas menu: its members' templates first, its workflow. */
export const useInstantiateWorkflowClass = (targets: ListedClassDto[]) => {
    const { instantiateWorkflowClass } = useHybridflow();
    const walk = useTemplateWizard();

    return useCallback((workflowClassId: string, spot: FlowNodeSpot) => {
        const steps = workflowTemplateStepsOf(targets, workflowClassId);
        const finish = (bodies?: InstantiateBodies) => {
            if (bodies === undefined) return instantiateWorkflowClass(workflowClassId, spot);
            return instantiateWorkflowClass(workflowClassId, spot, bodies);
        };
        if (steps.length === 0 || !workflowReadyForTemplates(targets, workflowClassId)) {
            finish();
            return;
        }
        walk(steps, finish);
    }, [targets, instantiateWorkflowClass, walk]);
};
