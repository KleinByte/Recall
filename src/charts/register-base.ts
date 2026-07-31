import { use } from "echarts/core"
import {
  BarChart,
  LineChart,
  RadarChart,
  ScatterChart,
} from "echarts/charts"
import {
  AriaComponent,
  DataZoomComponent,
  DatasetComponent,
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  RadarComponent,
  TooltipComponent,
} from "echarts/components"
import { LabelLayout, UniversalTransition } from "echarts/features"
import { CanvasRenderer } from "echarts/renderers"

let registered = false

export function registerBaseCharts() {
  if (registered) return

  use([
    BarChart,
    LineChart,
    RadarChart,
    ScatterChart,
    AriaComponent,
    DataZoomComponent,
    DatasetComponent,
    GridComponent,
    LegendComponent,
    MarkAreaComponent,
    MarkLineComponent,
    RadarComponent,
    TooltipComponent,
    LabelLayout,
    UniversalTransition,
    CanvasRenderer,
  ])
  registered = true
}
