import type { paths } from '@dentabill/api-sdk/types';

type OverviewPath = paths['/v1/operations']['get'];
type OutboxPath = paths['/v1/operations/outbox']['get'];
type PreviewPath = paths['/v1/operations/outbox/{id}']['get'];
type CallsPath = paths['/v1/operations/calls']['get'];
export type OperationsOverview = OverviewPath['responses'][200]['content']['application/json'];
export type DeliveryList = OutboxPath['responses'][200]['content']['application/json'];
export type RecoveryPreview = PreviewPath['responses'][200]['content']['application/json'];
export type OperationsCallList = CallsPath['responses'][200]['content']['application/json'];
export type DeliveryState = NonNullable<NonNullable<OutboxPath['parameters']['query']>['state']>;
export type OperationsCallKind = NonNullable<NonNullable<CallsPath['parameters']['query']>['kind']>;
export type RecoveryAction = 'RETRY' | 'CLOSE';
