export const CAREGIVER_ROLES = ['mother', 'father', 'parent', 'nanny', 'relative', 'other'] as const;
export const DAYCARE_ROLES = ['daycare_admin', 'daycare_employee'] as const;
export const USER_TYPES = ['caregiver', 'daycare'] as const;

export type CaregiverRole = (typeof CAREGIVER_ROLES)[number];
export type DaycareRole = (typeof DAYCARE_ROLES)[number];
export type UserType = (typeof USER_TYPES)[number];
