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

/** The instantiation wizard's entry on the central area's stack. */
export const CLASS_TEMPLATE_INSTANTIATION_PANEL_ID = 'class-template-instantiation';

/** One template the wizard walks: a class's latest published version, in template mode. */
export interface ClassTemplateStep {
    classId: string;
    classTitle: string;
    versionNumber: number;
    body: string;
}

/**
 * The templates an instantiation fills in: the latest published version of the class and each
 * successor, where it is in template mode — in chain order, head first. A task's alone: what
 * the board plays to itself is asked no description, so its versions are never stepped through,
 * however they are ticked.
 */
export const templateStepsOf = (
    classes: ListedClassDto[], classId: string,
): ClassTemplateStep[] => instantiationChainOf(readFlowNodeClasses(classes), classId)
    .flatMap(one => {
        const version = latestPublished(one);
        return version && version.template && isTask(one.type)
            ? [{ classId: one.id, classTitle: one.title, versionNumber: version.number, body: version.body }]
            : [];
    });

/**
 * Whether the chain is instantiated as the wizard needs: every class of it holding a published
 * version. Where one has none, the instantiation is refused as a whole — and the refusal is the
 * service's to word, so the wizard does not start and the call goes straight through.
 */
export const chainReadyForTemplates = (
    classes: ListedClassDto[], classId: string,
): boolean => {
    const chain = instantiationChainOf(readFlowNodeClasses(classes), classId);
    return chain.length > 0 && chain.every(one => latestPublished(one) !== null);
};

/**
 * The templates a workflow-class instantiation fills in: the latest published version of each
 * member, where it is in template mode — in member order. Members only, like the service:
 * a chain onto a class outside the rectangle is neither instantiated nor stepped through.
 */
export const workflowTemplateStepsOf = (
    classes: ListedClassDto[], workflowClassId: string,
): ClassTemplateStep[] => workflowMembersOf(readFlowNodeClasses(classes), workflowClassId)
    .flatMap(one => {
        const version = latestPublished(one);
        return version && version.template && isTask(one.type)
            ? [{ classId: one.id, classTitle: one.title, versionNumber: version.number, body: version.body }]
            : [];
    });

/**
 * Whether the workflow class is instantiated as the wizard needs: holding at least one
 * class, every member of it holding a published version. Where not, the call goes straight
 * through and the refusal is the service's to word.
 */
export const workflowReadyForTemplates = (
    classes: ListedClassDto[], workflowClassId: string,
): boolean => {
    const members = workflowMembersOf(readFlowNodeClasses(classes), workflowClassId);
    return members.length > 0 && members.every(one => latestPublished(one) !== null);
};

/**
 * The wizard itself: one panel per template, in the central area, in the same instantiation
 * panel a flow node template is written from — and Instantiate walks to the next one. When
 * all are filled, `finish` is called with the instantiated texts; cancelling anywhere along
 * the way calls nothing.
 */
const useTemplateWizard = () => {
    const { push, close } = useCentralStack();

    return useCallback((steps: ClassTemplateStep[], finish: (bodies: InstantiateBodies) => void) => {
        const pushStep = (index: number, bodies: InstantiateBodies) => {
            const step = steps[index];
            push({
                id: CLASS_TEMPLATE_INSTANTIATION_PANEL_ID,
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

/**
 * Instantiating a class from the canvas menu: its templates first, its flow nodes after.
 *
 * Where the class and its successors hold versions in template mode, each is filled in — one
 * panel per version, in the central area, in the same instantiation panel a flow node template
 * is written from — and Instantiate walks to the next one. When all are filled, the flow nodes
 * are made with the instantiated texts; cancelling anywhere along the way makes none.
 *
 * Where nothing of the chain is a template, or the chain is not instantiable at all, the call
 * goes straight through: the plain instantiation, and the service's own refusal where one has
 * nothing published.
 */
export const useInstantiateClass = (targets: ListedClassDto[]) => {
    const { instantiateFlowNodeClass } = useHybridflow();
    const walk = useTemplateWizard();

    return useCallback((classId: string, spot: FlowNodeSpot, workflow = '') => {
        const steps = templateStepsOf(targets, classId);
        // The rectangle travels only where one was named: a plain instantiation is the same
        // call it always was, down to the arguments.
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

/**
 * Instantiating a workflow class from the canvas menu: its members' templates first, its
 * workflow after.
 *
 * Where the members hold versions in template mode, each is filled in — one panel per
 * version, in member order — and the workflow is made with the instantiated texts;
 * cancelling anywhere along the way makes nothing. Where nothing of the members is a
 * template, or one has nothing published, the call goes straight through.
 */
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
