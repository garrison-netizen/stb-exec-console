// Private-event quote engine — PORTED from the live Private Event Calculator
// (stb-private-event-calculator/api/calc-data.js, decoded 2026-07-22). The
// calculator app remains the customer-facing source of truth: if pricing
// changes there, mirror it here (grep anchor: PRICING-SYNC).
//
// Rules: marginal per-person/per-hour facility tiers; SpindlePark add-on
// (SpindleBarn only); beverage billed on over-21 headcount with a 2-hour
// floor; per-facility minimums; off-peak = 10% off the FACILITY portion and
// 10% off the minimum. Cash Bar's per-person/hour figure excludes beverage
// (guests pay the bar directly).

export const FACILITY_TIERS = {
  'Entire Facility': [
    { max: 50, rate: 15 }, { max: 100, rate: 12 }, { max: 150, rate: 10 },
    { max: 200, rate: 9 }, { max: 300, rate: 8 }, { max: 400, rate: 7 },
    { max: Infinity, rate: 5 },
  ],
  'SpindleBarn': [
    { max: 50, rate: 10 }, { max: 100, rate: 9 }, { max: 150, rate: 7 }, { max: 200, rate: 5 },
  ],
  'Taproom': [
    { max: 50, rate: 10 }, { max: 100, rate: 9 }, { max: 150, rate: 7 }, { max: 200, rate: 5 },
  ],
  'Production Facility': [{ max: 50, rate: 7 }],
  'Beer Garden': [{ max: 50, rate: 7 }],
}

const SPINDLEPARK_TIERS = [
  { min: 1, max: 50, rate: 4 },
  { min: 51, max: 100, rate: 3 },
  { min: 101, max: 150, rate: 2 },
  { min: 151, max: 200, rate: 1 },
]

export const BEVERAGE_RATES = {
  'Open Bar Premium': 9,
  'Open Bar Basic': 6,
  'Cash Bar': 4,
  'Dry Event': 0,
}

export const FACILITY_MINIMUMS = {
  'Entire Facility': 5000,
  'SpindleBarn': 2000,
  'Taproom': 2000,
  'Production Facility': 750,
  'Beer Garden': 750,
}

const CAPACITY = {
  'Production Facility': 50,
  'Beer Garden': 50,
  'SpindleBarn': 200,
  'Taproom': 200,
}

export function quoteEvent({
  facility,
  beverage,
  attendees,
  attendeesOver21 = 0,
  hours,
  spindlePark = false,
  offPeak = false,
}) {
  const tiers = FACILITY_TIERS[facility]
  if (!tiers) return { error: `Unknown facility "${facility}". Options: ${Object.keys(FACILITY_TIERS).join(', ')}` }
  if (!(beverage in BEVERAGE_RATES)) return { error: `Unknown beverage package "${beverage}". Options: ${Object.keys(BEVERAGE_RATES).join(', ')}` }
  if (!attendees || !hours || attendees < 1) return { error: 'attendees and hours are required' }
  if (attendeesOver21 > attendees || attendeesOver21 < 0) return { error: 'attendeesOver21 must be between 0 and attendees' }
  if (hours < 2) return { error: 'Facility rentals require a minimum of 2 hours' }
  if (CAPACITY[facility] && attendees > CAPACITY[facility]) {
    return { error: `${facility} max capacity is ${CAPACITY[facility]}` }
  }
  if (spindlePark && facility !== 'SpindleBarn') {
    return { error: 'SpindlePark add-on is only available with SpindleBarn' }
  }

  // Marginal facility tiers: each attendee band billed at its own rate.
  let facilityCost = 0
  let remaining = attendees
  let start = 1
  for (const tier of tiers) {
    if (remaining <= 0) break
    const end = Math.min(tier.max, attendees)
    const segment = Math.min(remaining, end - start + 1)
    if (segment > 0) facilityCost += segment * hours * tier.rate
    remaining -= segment
    start = end + 1
  }

  let spindleParkCost = 0
  if (spindlePark && facility === 'SpindleBarn') {
    let rem = attendees
    for (const tier of SPINDLEPARK_TIERS) {
      if (rem <= 0) break
      const segment = Math.min(rem, tier.max - (tier.min - 1))
      if (segment > 0) {
        spindleParkCost += segment * hours * tier.rate
        rem -= segment
      }
    }
    facilityCost += spindleParkCost
  }

  // Beverage: billed on over-21 count, minimum 2 hours.
  const effectiveHours = Math.max(hours, 2)
  const beverageCost = beverage === 'Dry Event' ? 0 : attendeesOver21 * effectiveHours * BEVERAGE_RATES[beverage]

  const minimum = FACILITY_MINIMUMS[facility]
  const adjustedMinimum = offPeak ? minimum * 0.9 : minimum
  const discount = offPeak ? facilityCost * 0.1 : 0
  const subtotal = facilityCost + beverageCost - discount

  const minimumEnforced = subtotal < adjustedMinimum
  const total = minimumEnforced ? adjustedMinimum : subtotal

  const discountedFacilityCost = facilityCost - discount
  const perPersonPerHour =
    beverage === 'Cash Bar'
      ? discountedFacilityCost / (attendees * hours) || 0
      : total / (attendees * hours) || 0

  return {
    facility,
    beverage,
    attendees,
    attendeesOver21,
    hours,
    spindlePark,
    offPeak,
    facilityCost: round2(facilityCost),
    spindleParkCost: round2(spindleParkCost),
    beverageCost: round2(beverageCost),
    offPeakDiscount: round2(discount),
    minimum: round2(adjustedMinimum),
    minimumEnforced,
    total: round2(total),
    perPersonPerHour: round2(perPersonPerHour),
    notes: [
      ...(minimumEnforced ? [`Facility minimum of $${adjustedMinimum.toLocaleString('en-US')} applies (computed subtotal was $${round2(subtotal).toLocaleString('en-US')}).`] : []),
      ...(beverage === 'Cash Bar' ? ['Cash Bar: guests pay the bar directly; the per-person/hour figure reflects facility only.'] : []),
      ...(beverage === 'Dry Event' ? ['Dry Event: no beverage service charge.'] : []),
    ],
  }
}

const round2 = (n) => Math.round(n * 100) / 100
