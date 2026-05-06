export {
  validateTemplateVars,
  NotifierValidationError,
  type NotifierPort,
  type NotifyInput,
  type NotifyResult,
} from './port.js';
export { FakeResend, type FakeDelivery } from './fake.js';
export {
  LiveResend,
  createNotifierPort,
  type CreateNotifierPortInput,
  type CreateNotifierPortResult,
  type LiveResendOptions,
} from './live.js';
export {
  TEMPLATES,
  ClaimResolvedTemplate,
  ClaimNeedsInfoTemplate,
  ClaimDeniedTemplate,
  SummaryDlqTemplate,
  type TemplateName,
  type TemplateVars,
  type ClaimResolvedVars,
  type ClaimNeedsInfoVars,
  type ClaimDeniedVars,
  type SummaryDlqVars,
} from './templates/index.js';
