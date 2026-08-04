import type { PersonalRecord } from "./stats"

export interface RecordNotification {
  id: string
  gameId: number
  records: PersonalRecord[]
  createdAt: number
  read: boolean
}
