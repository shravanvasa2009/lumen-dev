import { Platform } from 'react-native';

// The two people in the film: the Galaxy A17 is Shravan's, the iPhone 17 Pro is Nitin's (owner, 2026-10-17).
export type Person = {
  name: string;
  age: string;
  heightIn: string;
  weightLb: string;
  // dr.family, dr.bp, dr.active
  familyHistory: boolean;
  highBloodPressure: boolean;
  active: boolean;
};

const SHRAVAN: Person = {
  name: 'Shravan',
  age: '16',
  heightIn: '68',
  weightLb: '135',
  familyHistory: true,
  highBloodPressure: false,
  active: false,
};

const NITIN: Person = {
  name: 'Nitin',
  age: '17',
  heightIn: '74',
  weightLb: '150',
  familyHistory: false,
  highBloodPressure: false,
  active: true,
};

export const person: Person = Platform.OS === 'ios' ? NITIN : SHRAVAN;
