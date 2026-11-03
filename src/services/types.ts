export type PricingModel = 'hourly' | 'fixed' | 'quote'
export type LocationKind = 'online' | 'customer' | 'seller'
export type BookingStatus = 'Hold' | 'Requested' | 'Confirmed' | 'Rescheduled' | 'InProgress' | 'Completed' | 'Declined' | 'Expired' | 'CancelledByBuyer' | 'CancelledBySeller' | 'NoShow'

export interface IntakeQuestion { id?: string; label: string; type: 'text' | 'choice' | 'yesno'; options?: string[]; required: boolean }
export interface AddOnDto { id?: string; name: string; price: number | null; extraMinutes: number | null }
export interface ServiceArea { postalCodes: string[]; radius: { baseAddress: string | null; lat: number | null; lng: number | null; distance: number | null; unit: 'km' | 'mi' | null } | null }

/** The service sections of a listing (GET detail `service`, PUT /seller/services/{id}/details). */
export interface ServiceDetails {
  pricingModel: PricingModel; price: number | null; minMinutes: number | null; maxMinutes: number | null; incrementMinutes: number; defaultDurationMinutes: number
  bufferBeforeMinutes: number; bufferAfterMinutes: number; minNoticeHours: number; maxAdvanceDays: number; slotGranularityMinutes: number
  online: boolean; onlineInstructions: string | null; atCustomer: boolean; serviceArea: ServiceArea; travelFee: number | null; travelBufferMinutes: number
  atSeller: boolean; sellerAddress: string | null; bookingMode: 'instant' | 'request'; approvalHours: number
  intake: IntakeQuestion[]; requirements: string | null; addOns: AddOnDto[]
  cancelFreeHours: number; cancelFeePercent: number; maxReschedules: number; noShowFeePercent: number
  assignmentRule: 'buyerchoice' | 'leastbusy' | 'roundrobin'; readyProviders: number
}

export interface ProviderRow {
  membershipId: string; email: string; role: string; isProvider: boolean; timeZone: string | null; effectiveTimeZone: string
  reminderDayBefore: boolean; reminderHourBefore: boolean; icsActive: boolean; isMe: boolean
}
export interface ProviderList { accountTimeZone: string; providers: ProviderRow[] }
export interface ServiceProviderChoice { membershipId: string; email: string; role: string; timeZone: string | null; eligible: boolean }

export interface Interval { start: string; end: string }
export interface Availability { timeZone: string; weekly: { day: number; intervals: Interval[] }[]; overrides: { date: string; intervals: Interval[] }[] }
export interface BlockDto { id: string; providerId: string; kind: 'timeoff' | 'busy'; startAt: string; endAt: string; allDay: boolean; note: string | null }

export interface CalendarBooking {
  id: string; number: string; status: BookingStatus; title: string; serviceId: string; brandId: string; providerId: string
  startAt: string; endAt: string; location: LocationKind; buyerName: string | null; canAct: boolean
}
export interface CalendarProvider { membershipId: string; email: string; timeZone: string; isMe: boolean }
export interface CalendarData {
  from: string; to: string; accountTimeZone: string; combined: boolean; providers: CalendarProvider[]; blocks: BlockDto[]
  workingHours: { providerId: string; start: string; end: string }[]; bookings: CalendarBooking[]
}

export interface BookingListItem {
  id: string; number: string; status: BookingStatus; serviceId: string; serviceTitle: string; brandId: string; providerId: string; location: LocationKind
  startAt: string; endAt: string; totalCents: number; approvalDeadline: string | null; rescheduleRequested: boolean; isMine: boolean; buyerName: string | null
}
export interface BookingList { items: BookingListItem[]; total: number; page: number; pageSize: number }
export interface BookingCounts { requests: number; today: number; upcoming: number; quoteRequests: number; needsAction: number }

export interface BookingActions { approve: boolean; decline: boolean; propose: boolean; reschedule: boolean; cancel: boolean; start: boolean; complete: boolean; noShow: boolean; reassign: boolean; decideReschedule: boolean }
export interface BookingDetail {
  id: string; number: string; status: BookingStatus; version: number; serviceId: string; serviceTitle: string; brandId: string; providerId: string; providerEmail: string | null
  providerTimeZone: string; isMine: boolean; location: LocationKind; startAt: string; endAt: string; durationMinutes: number
  approvalDeadline: string | null; proposedStartAt: string | null; rescheduleRequestedStartAt: string | null; rescheduleCount: number
  pricing: { model: string; rateCents: number; priceCents: number; addOnsCents: number; travelFeeCents: number; totalCents: number; cancellationFeeCents: number; additionalChargeCents: number; actualMinutes: number | null }
  policy: { cancelFreeHours: number; cancelFeePercent: number; maxReschedules: number; noShowFeePercent: number; incrementMinutes: number; approvalHours: number } | null
  addOns: { id: string; name: string; priceCents: number; extraMinutes: number }[]
  intake: { id: string; question: string; answer: string | null }[]
  customer: { name: string | null; phone: string | null; address: Record<string, string> | null; postalCode: string | null; visible: boolean; redacted: boolean }
  onlineInstructions: string | null; sellerAddress: string | null; requirements: string | null
  timeline: { at: string; type: string; actor: string; text: string | null }[]
  actions: BookingActions; createdAt: string
}
export interface BookingMessage { id: string; direction: 'buyer' | 'seller'; text: string; createdAt: string; mine: boolean }

export type QuoteStatus = 'Requested' | 'Quoted' | 'Accepted' | 'Declined' | 'Expired' | 'Withdrawn'
export interface QuoteDto {
  id: string; status: QuoteStatus; serviceId: string; serviceTitle: string; brandId: string; location: LocationKind
  buyerName: string | null; details: string | null; postalCode: string | null; preferredTimes: string[] | null; address: Record<string, string> | null; phone: string | null
  quote: { priceCents: number; durationMinutes: number; slots: string[]; providerId: string; expiresAt: string; note: string | null; quotedAt: string } | null
  bookingId: string | null; declineReason: string | null; createdAt: string; version: number
}
export interface QuoteList { items: QuoteDto[]; total: number; page: number; pageSize: number }
