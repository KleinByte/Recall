import { use } from "echarts/core"
import {
  BoxplotChart,
  CustomChart,
  HeatmapChart,
  ParallelChart,
  SankeyChart,
  TreemapChart,
} from "echarts/charts"
import {
  BrushComponent,
  CalendarComponent,
  ParallelComponent,
  VisualMapComponent,
} from "echarts/components"

let registered = false

export function registerInsightCharts() {
  if (registered) return

  use([
    BoxplotChart,
    CustomChart,
    HeatmapChart,
    ParallelChart,
    SankeyChart,
    TreemapChart,
    BrushComponent,
    CalendarComponent,
    ParallelComponent,
    VisualMapComponent,
  ])
  registered = true
}
