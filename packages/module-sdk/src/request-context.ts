export interface HomiRequestContext {
  requestId: string;
  userId: string;
  householdId: string;
  membershipId: string;
  householdPersonId: string;
  clientId?: string;
  locale: string;
  timeZone: string;
}
