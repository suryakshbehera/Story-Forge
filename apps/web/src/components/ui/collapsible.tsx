"use client"

import * as React from "react"
import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible"

import { cn } from "@/lib/utils"

function Collapsible({ ...props }: CollapsiblePrimitive.Root.Props) {
  return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />
}

function CollapsibleTrigger({ className, ...props }: CollapsiblePrimitive.Trigger.Props) {
  return (
    <CollapsiblePrimitive.Trigger
      data-slot="collapsible-trigger"
      className={cn("outline-none", className)}
      {...props}
    />
  )
}

function CollapsiblePanel({ className, keepMounted = true, ...props }: CollapsiblePrimitive.Panel.Props) {
  // keepMounted defaults to true here (Base UI itself defaults to false) —
  // panels wrap live forms with local unsaved-edit state (scene voice/video/
  // audio panels), which must not be thrown away by an unmount when a
  // section collapses.
  return (
    <CollapsiblePrimitive.Panel
      data-slot="collapsible-panel"
      keepMounted={keepMounted}
      className={cn(
        "h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-150 ease-out data-ending-style:h-0 data-starting-style:h-0",
        className
      )}
      {...props}
    />
  )
}

export { Collapsible, CollapsibleTrigger, CollapsiblePanel }
