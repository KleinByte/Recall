export interface PatchNoteSection {
  title: string
  items: string[]
}

export interface PatchNoteRelease {
  version: string
  releasedAt: string
  title: string
  summary: string
  sections: PatchNoteSection[]
}
