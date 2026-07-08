## This week's updates — Network Visualization

**Recap:** Last time's feedback was that the network graph looked good but wasn't actually helping find the leak — only the heatmap was. This week we fixed that.

### 1. Click an edge to see the messages

Before, edges only showed *that* two agents talked, not *what* they said. Now clicking an edge opens a panel with the real messages behind that connection, same style as the heatmap's message panel.

### 2. Simplified the network controls

The old three-way switch ("Independent / Follow timeline / Mirror heatmap") mixed two unrelated things into one control. We split it into two independent toggles — "Mirror heatmap filters" and "Follow timeline" — each doing exactly what it says.

### 3. Ajay's Hints Timeline

Previously Ajay just had a mention count next to his name. Now a button opens a chronological timeline of everything said about him, with quoted phrases pulled out automatically. The story is compelling: vague hints like "strategic developments" and "identifiable catalysts" escalate into explicit secrecy — "whatever I share stays among the senior team" — and finally "career-defining good." You can watch the CEO's hints sharpen as the merger nears, all in one place instead of scattered across dozens of messages.

### 4. A concrete finding

All 12 "anonymous post" messages in the dataset came from a single agent — the legal agent. Exactly the kind of thing this tool should surface, and now it can.

### 5. Smaller fixes

- Fixed a bug where clicking an edge reset the graph layout.
- Heatmap now uses a white-to-blue color scale for better low-count visibility.

### Still missing

No automatic "who's behind this anonymous post" suggestion yet — that's the natural next step.
