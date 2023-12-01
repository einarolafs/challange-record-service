import { type Record, type User } from './types';

// Validation function for the record data
export function isValidRecord(data: any): data is Record {
  return (
    Boolean(data) &&
    typeof data.userId === 'string' &&
    typeof data.org === 'string' &&
    typeof data.emissionGasName === 'string' &&
    typeof data.quantity === 'number' &&
    typeof data.unit === 'string'
  );
}

export function isValidUser(data: any): data is User {
  return (
    Boolean(data) &&
    typeof data.userId === 'string' &&
    typeof data.name === 'string' &&
    typeof data.org === 'string'
  );
}
