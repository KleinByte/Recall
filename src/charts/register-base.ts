import { use } from "echarts/core"
import {
  BarChart,
  HeatmapChart,
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
  VisualMapContinuousComponent,
} from "echarts/components"
import { LabelLayout, UniversalTransition } from "echarts/features"
import { CanvasRenderer } from "echarts/renderers"

let registered = false

export function registerBaseCharts() {
  if (registered) return

  use([
    BarChart,
    HeatmapChart,
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
    VisualMapContinuousComponent,
    LabelLayout,
    UniversalTransition,
    CanvasRenderer,
  ])
  registered = true
}
