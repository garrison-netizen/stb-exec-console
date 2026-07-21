import React from 'react'
import DeptChat from './DeptChat.jsx'

// Production space: chat over the Ekos mirror (read-only analyst).
// UI lives in DeptChat; this wrapper supplies the Production specifics.

// Pool of starter questions; each fresh conversation deals a random six so
// the welcome screen stays lively and teaches the bot's range over time.
const STARTER_POOL = [
  // Inventory
  'What finished beer is on hand right now?',
  'What inventory is expiring in the next 60 days?',
  'What is our total inventory value by category?',
  'What is sitting in WIP right now?',
  'How much packaging inventory do we have on hand?',
  // Production
  'Which batches are in progress?',
  'What did we finish brewing last month?',
  'How does Houston Haze production this year compare to last?',
  'How have yields trended on Heavy Hands batches?',
  'How many barrels have we produced this year?',
  // Losses
  'What did we lose to breakage and spoilage this quarter, in dollars?',
  'How are losses trending month by month this year?',
  'Which items have we destroyed or written off most this year?',
  // Purchasing
  'What POs are still open and when do they land?',
  'How have hop prices trended over the last two years?',
  'Who are our top vendors by spend this year?',
  // Sales out the door
  'Top sellers this year by revenue?',
  'How do taproom sales compare to wholesale this year?',
  'How is the coffee line performing this year?',
]

export default function ProductionChat() {
  return (
    <DeptChat
      endpoint="/api/chat"
      title="Production Assistant"
      sub="Inventory, batches, yields, losses, purchasing, and sales — straight from Ekos."
      starterPool={STARTER_POOL}
      storagePrefix="stb_prodchat"
      inputPlaceholder="Ask a production question…"
      freshTitle="When the Ekos data snapshot was last refreshed"
    />
  )
}
