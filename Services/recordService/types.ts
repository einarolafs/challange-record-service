// Interfaces based on provided data structures
export interface User {
  userId: string;
  name: string;
  org: string;
}

export interface Record {
  recordId?: string;
  userId: string;
  org: string;
  emissionGasName: string;
  quantity: number;
  unit: string;
}
