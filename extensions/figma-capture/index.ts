import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { registerFigmaCaptureTool } from "./figma-capture.js";

export default definePluginEntry({
  id: "figma-capture",
  name: "Figma Capture Plugin",
  description: "Push local HTML to Figma as editable designs via Figma MCP",
  register(api) {
    registerFigmaCaptureTool(api);
  },
});
