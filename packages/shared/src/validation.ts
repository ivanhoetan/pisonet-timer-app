import type { ZodError, ZodIssue } from 'zod';

const FIELD_LABELS: Record<string, string> = {
  username: 'Username',
  nickname: 'Nickname',
  password: 'Password',
  currentPassword: 'Current password',
  newPassword: 'New password',
  pin: 'PIN',
  email: 'Email',
  mobileNumber: 'Mobile number',
  computerId: 'Computer',
  computerCode: 'Computer code',
  code: 'Pairing code',
  name: 'Name',
  pesos: 'Amount',
  minutesAdded: 'Minutes',
  minutesRemoved: 'Minutes to remove',
  stampsRemoved: 'Stamps to remove',
  rewards: 'Rewards',
  userId: 'User',
  reason: 'Reason',
  paymentMethod: 'Payment method',
  paymentReference: 'Reference',
  initialMinutes: 'Starting time',
  status: 'Status',
  role: 'Role',
  sessionId: 'Session',
  authSecret: 'Auth secret',
  enabled: 'Enabled',
};

function fieldLabel(path: ZodIssue['path']): string {
  const key = path[0];
  if (typeof key === 'string') {
    return FIELD_LABELS[key] || key.charAt(0).toUpperCase() + key.slice(1);
  }
  return 'Input';
}

function isGenericZodMessage(message: string): boolean {
  return (
    message === 'Required' ||
    message === 'Invalid input' ||
    message === 'Invalid email' ||
    message.startsWith('String must contain') ||
    message.startsWith('Number must be') ||
    message.startsWith('Expected ') ||
    message === 'Invalid'
  );
}

function formatIssue(issue: ZodIssue): string {
  if (issue.message && !isGenericZodMessage(issue.message)) {
    return issue.message;
  }

  const label = fieldLabel(issue.path);

  switch (issue.code) {
    case 'too_small':
      if (issue.type === 'string' && issue.minimum === 1) {
        return `${label} is required`;
      }
      if (issue.type === 'string') {
        return `${label} must be at least ${issue.minimum} characters`;
      }
      if (issue.type === 'number') {
        return `${label} must be at least ${issue.minimum}`;
      }
      break;
    case 'too_big':
      if (issue.type === 'string') {
        return `${label} cannot exceed ${issue.maximum} characters`;
      }
      if (issue.type === 'number') {
        return `${label} cannot exceed ${issue.maximum}`;
      }
      break;
    case 'invalid_string':
      if (issue.validation === 'email') {
        return 'Enter a valid email address';
      }
      if (issue.validation === 'regex') {
        if (issue.path[0] === 'username') {
          return 'Username may only contain letters, numbers, and underscores';
        }
        if (issue.path[0] === 'pin') {
          return 'PIN must be 4–6 digits';
        }
        if (issue.path[0] === 'computerCode') {
          return 'Computer code may only contain letters, numbers, - and _';
        }
        return `${label} format is invalid`;
      }
      break;
    case 'invalid_type':
      if (issue.received === 'undefined' || issue.received === 'null') {
        return `${label} is required`;
      }
      break;
    case 'custom':
      return issue.message || 'Please check your input and try again';
  }

  return issue.message || `${label} is invalid`;
}

/** Turn a Zod error into a short, user-facing sentence. */
export function formatValidationError(error: ZodError): string {
  const messages = error.issues.map(formatIssue).filter(Boolean);
  if (messages.length === 0) {
    return 'Please check your input and try again.';
  }
  if (messages.length === 1) {
    return messages[0];
  }
  return messages.slice(0, 3).join(' · ');
}
