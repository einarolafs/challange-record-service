import { type Record } from './types';

// Fake records
const fakeRecords: Record[] = [
  {
    userId: 'uuid-user-1',
    org: 'uuid-org-1',
    emissionGasName: 'CO2',
    quantity: 100,
    unit: 'kg',
  },
  // ... add more fake records as needed
];

export function populateFakeData(): Map<string, Record> {
  const recordsDb = new Map<string, Record>();
  fakeRecords.forEach((record, index) => {
    recordsDb.set(`fake-record-${index}`, record);
  });
  return recordsDb;
}
