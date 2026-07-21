import React from 'react'
import DeptChat from './DeptChat.jsx'

// Events space: chat over the Private Events data (Triple Seat daily sync) —
// read-only analyst for leads, bookings, revenue, and payments.

const STARTER_POOL = [
  // Revenue
  'How much private-event revenue have we booked this year?',
  'How does this year compare to last year, month by month?',
  'What was our biggest event this year?',
  'What is our average event revenue and headcount?',
  // Pipeline
  'What events are on the books for next month?',
  'What weddings are in the pipeline right now?',
  'Which rep has the most upcoming events?',
  'What is the biggest event coming up?',
  // Leads
  'What is our lead conversion rate over the last 90 days?',
  'Which lead sources produce the most bookings?',
  'How many leads came in this month, and from where?',
  'How long do leads usually take to convert?',
  'How many pending leads are sitting older than two weeks?',
  // Payments
  'Which past events still show an unpaid balance?',
  'Which upcoming events have no deposit recorded?',
  // Seasonal
  'How does this summer compare to last summer for bookings?',
  'Which months are historically our strongest for events?',
]

export default function EventsChat() {
  return (
    <DeptChat
      endpoint="/api/events-chat"
      title="Events Assistant"
      sub="Leads, bookings, revenue, and payments — straight from Triple Seat."
      starterPool={STARTER_POOL}
      storagePrefix="stb_evchat"
      inputPlaceholder="Ask an events question…"
      freshTitle="When the private-events data was last loaded from Notion"
    />
  )
}
