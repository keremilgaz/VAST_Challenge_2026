
import React from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { formatRecipients } from '../utils.js';
import { EVENT_RELATED_BY_MESSAGE_ID, SEQ_KINDS } from '../constants.js';
import { messageNumber } from '../commIdMap.js';
import { AGENTS } from '../network.jsx';

export function MessageDetailPanel({ selected, selectedCellData, selectedSemantic, semanticComparisonMode, collapsed, setCollapsed, messages, rounds, selectedMessageId, messageContext, contextStatus, onSelectMessage, onOpenFlow }) {
  if (!selected) {
    return <div className="detail-card empty"><span className="muted">Click a heatmap cell or a time header to see its messages here.</span></div>;
  }
  const count = selectedCellData?.message_count ?? messages.length;
  return (
    <div className="detail-card">
      <div className="detail-summary" onClick={() => setCollapsed(c => !c)}>
        <button className="collapse-btn" aria-label="toggle">
          {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
        </button>
        <div className="ds-text">
          <b>{selected.agent.agent_label}</b>
          <span className="ds-pipe">|</span> {selected.bucket}
          <span className="ds-pipe">|</span> {count} messages
        </div>
        <span className="ds-hint">{collapsed ? 'Expand messages' : 'Collapse'}</span>
      </div>

      {!collapsed && (
        <div className="detail-body">
          {/* event context */}
          {rounds.length > 0 && (
            <div className="rounds">
              {rounds.map(r => (
                <article className="round" key={r.hour}>
                  <div className="round-hour">{r.hour}</div>
                  <h4>{r.event_headline || '(no headline)'}</h4>
                  <p>{r.event_narrative || ''}</p>
                  <div className="chips">
                    {r.has_merger_context && <span className="merger">merger context</span>}
                  </div>
                </article>
              ))}
            </div>
          )}

          <h3>Messages ({messages.length})</h3>
          <MessageList messages={messages} selectedMessageId={selectedMessageId} onSelectMessage={onSelectMessage} />

          {/* clicking any message opens the related-messages chat popup */}
          {selectedMessageId && (
            <div className="ctx-hint">
              <span className="muted">
                {contextStatus === 'loading' ? 'Loading related messages…'
                  : contextStatus === 'error' ? 'Could not load related messages.'
                  : 'Related messages open in a chat popup.'}
              </span>
              <button className="flow-btn" onClick={(e) => { e.stopPropagation(); onOpenFlow && onOpenFlow(); }}>
                Open conversation
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function MessageList({ messages, selectedMessageId, onSelectMessage, renderExtra }) {
  if (!messages.length) {
    return <p className="muted">No messages matched the current filters.</p>;
  }
  return messages.map(m => (
    <article
      className={`message clickable${m.message_id === selectedMessageId ? ' selected' : ''}`}
      key={m.message_id}
      onClick={() => onSelectMessage && onSelectMessage(m.message_id)}
      title="Click to see this message's context / related messages"
    >
      {renderExtra && renderExtra(m)}
      <div className="msg-meta">
        {m.comm_id != null && <span className="comm-id">#{m.comm_id}</span>}
        <b>{m.timestamp}</b>
        <span>{m.agent_label}</span>
        <span>{m.channel}</span>
        <span>{m.visibility}</span>
        {m.keyword_score > 0 && <span className="keyword-score">keyword score: {m.keyword_score}</span>}
        {m.is_merger_related && <span className="merger">content merger-related</span>}
        {m.internal_merger_related && <span className="internal-merger">internal merger-related</span>}
        {EVENT_RELATED_BY_MESSAGE_ID.has(m.message_id) &&
          EVENT_RELATED_BY_MESSAGE_ID.get(m.message_id).map(ev => {
            const kind = SEQ_KINDS[ev.kind] || SEQ_KINDS.decision;
            return (
              <span key={ev.id} className="event-related"
                style={{ borderColor: kind.color, color: kind.color }}
                title={`Event related message · ${ev.title} (${kind.label})`}>
                event_related · {kind.label}
              </span>
            );
          })}
      </div>
      <div className="sub-meta">
        Role: {m.agent_role || '-'} / Recipients: {formatRecipients(m.recipients)} / Responding to: {(() => {
          if (!m.responding_to) return '-';
          const n = messageNumber(m.responding_to);
          return n != null ? `#${n}` : m.responding_to;
        })()}
      </div>
      <p>{m.content}</p>
      {(m.internal_reacting || m.internal_rationalizing || m.internal_deliberating) && (
        <details onClick={e => e.stopPropagation()}>
          <summary>internal state</summary>
          {m.internal_reacting && <p><b>reacting:</b> {m.internal_reacting}</p>}
          {m.internal_rationalizing && <p><b>rationalizing:</b> {m.internal_rationalizing}</p>}
          {m.internal_deliberating && <p><b>deliberating:</b> {m.internal_deliberating}</p>}
        </details>
      )}
    </article>
  ));
}

export function EdgeMessagesPanel({ selectedEdge, messages, collapsed, setCollapsed, selectedMessageId, messageContext, contextStatus, onSelectMessage, onOpenFlow }) {
  if (!selectedEdge) {
    return <div className="detail-card empty"><span className="muted">Click a network edge to see the messages behind that connection here.</span></div>;
  }
  const { sourceLabel, targetLabel, channel, message_type: messageType, mention } = selectedEdge;
  // comms_huddle broadcast/action ayrı edge'ler — başlıkta message_type'ı da göster.
  const channelText = channel === 'comms_huddle' && messageType ? `${channel} (${messageType})` : channel;
  return (
    <div className="detail-card">
      <div className="detail-summary" onClick={() => setCollapsed(c => !c)}>
        <button className="collapse-btn" aria-label="toggle">
          {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
        </button>
        <div className="ds-text">
          <b>{sourceLabel}</b> {mention ? 'addresses by name' : '→'} <b>{targetLabel}</b>
          {!mention && <><span className="ds-pipe">|</span> {channelText}</>}
          <span className="ds-pipe">|</span> {messages.length} messages
        </div>
        <span className="ds-hint">{collapsed ? 'Expand messages' : 'Collapse'}</span>
      </div>

      {!collapsed && (
        <div className="detail-body">
          <h3>Messages ({messages.length})</h3>
          <MessageList messages={messages} selectedMessageId={selectedMessageId} onSelectMessage={onSelectMessage} />

          {selectedMessageId && (
            <div className="ctx-hint">
              <span className="muted">
                {contextStatus === 'loading' ? 'Loading related messages…'
                  : contextStatus === 'error' ? 'Could not load related messages.'
                  : 'Related messages open in a chat popup.'}
              </span>
              <button className="flow-btn" onClick={(e) => { e.stopPropagation(); onOpenFlow && onOpenFlow(); }}>
                Open conversation
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Network node click → Node Messages Panel
// Bir node seçilince o agent'ın (mevcut network filtresiyle) gönderdiği TÜM
// mesajları gösterir — reply graph'ta edge'e dönüşmeyen broadcast / root
// mesajlar dahil. Bu mesajlara daha önce chat panelinden erişilemiyordu.
export function NodeMessagesPanel({ node, messages, collapsed, setCollapsed, selectedMessageId, contextStatus, onSelectMessage, onOpenFlow }) {
  if (!node) return null;
  const nonReply = messages.filter(m => !m.resolved_parent_id).length;
  return (
    <div className="detail-card">
      <div className="detail-summary" onClick={() => setCollapsed(c => !c)}>
        <button className="collapse-btn" aria-label="toggle">
          {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
        </button>
        <div className="ds-text">
          <b>{node.label}</b> — all sent messages
          <span className="ds-pipe">|</span> {messages.length} messages
          {nonReply > 0 && <><span className="ds-pipe">|</span> ◌ {nonReply} non-reply (broadcast/root)</>}
        </div>
        <span className="ds-hint">{collapsed ? 'Expand messages' : 'Collapse'}</span>
      </div>

      {!collapsed && (
        <div className="detail-body">
          <h3>Messages ({messages.length})</h3>
          <MessageList
            messages={messages}
            selectedMessageId={selectedMessageId}
            onSelectMessage={onSelectMessage}
            renderExtra={(m) => !m.resolved_parent_id ? (
              <span className="bc-chip" title="This message is not a reply to another agent — a broadcast to ALL or a thread-starting post. It has no edge in the reply graph.">
                ◌ non-reply (broadcast/root)
              </span>
            ) : null}
          />

          {selectedMessageId && (
            <div className="ctx-hint">
              <span className="muted">
                {contextStatus === 'loading' ? 'Loading related messages…'
                  : contextStatus === 'error' ? 'Could not load related messages.'
                  : 'Related messages open in a chat popup.'}
              </span>
              <button className="flow-btn" onClick={(e) => { e.stopPropagation(); onOpenFlow && onOpenFlow(); }}>
                Open conversation
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function RelatedMessages({ status, context, selectedMessageId, onSelectMessage, onOpenFlow }) {
  if (status === 'loading') {
    return <div className="context-section"><span className="muted">Loading related messages…</span></div>;
  }
  if (status === 'error') {
    return <div className="context-section"><span className="muted">Could not load related messages.</span></div>;
  }
  if (!context || !context.found) {
    return <div className="context-section"><span className="muted">No context found for this message.</span></div>;
  }

  const groups = [
    ['Parent', context.parent_message ? [context.parent_message] : []],
    ['Replies', context.replies || []],
    ['Nearby Timeline', context.temporal_neighbors || []],
    ['Same Channel', context.same_channel_context || []],
    ['Same Agent', context.same_agent_context || []],
    ['Keyword Related', context.keyword_related || []],
  ];
  const why = context.selected_message && context.selected_message.why_matters;
  const sel = context.selected_message;

  return (
    <div className="context-section" onClick={e => e.stopPropagation()}>
      <div className="ctx-header-row">
        <div className="ctx-header">Context for selected message</div>
        <button className="flow-btn" onClick={() => onOpenFlow && onOpenFlow()}>Conversation Flow</button>
      </div>
      {sel && (
        <div className="ctx-focused">
          <div className="ctx-item-meta">
            {sel.comm_id != null && <span className="comm-id">#{sel.comm_id}</span>}
            <span className="ctx-badge">{sel.channel}</span>
            <span className="ctx-agent">{sel.agent_label}</span>
            <span className="ctx-ts">{sel.timestamp}</span>
          </div>
          <div className="ctx-preview">
            {(sel.content || '').slice(0, 200)}{(sel.content || '').length > 200 ? '…' : ''}
          </div>
        </div>
      )}
      {why && <div className="why-matters"><b>Why this matters:</b> {why}</div>}
      {groups.every(([, items]) => items.length === 0) && (
        <span className="muted">No related messages for this one.</span>
      )}
      {groups.map(([label, items]) => (
        items.length > 0 && (
          <div className="ctx-group" key={label}>
            <div className="ctx-group-title">{label} ({items.length})</div>
            {items.map(it => (
              <div
                className={`ctx-item${it.message_id === selectedMessageId ? ' selected' : ''}`}
                key={`${label}-${it.message_id}`}
                onClick={() => onSelectMessage && onSelectMessage(it.message_id)}
                title="Click to focus this message"
              >
                <div className="ctx-item-meta">
                  {it.comm_id != null && <span className="comm-id">#{it.comm_id}</span>}
                  <span className="ctx-badge">{it.channel}</span>
                  <span className="ctx-agent">{it.agent_label}</span>
                  <span className="ctx-ts">{it.timestamp}</span>
                  <span className="ctx-reason">{it.relation_reason}</span>
                </div>
                <div className="ctx-preview">
                  {(it.content || '').slice(0, 160)}{(it.content || '').length > 160 ? '…' : ''}
                </div>
              </div>
            ))}
          </div>
        )
      ))}
    </div>
  );
}

// Conversation Flow modal (chat-history style)
const KIND_TAG = {
  direct: { label: 'direct reply', color: '#22c55e' },
  addressed: { label: 'addressed', color: '#f59e0b' },
  root: { label: 'thread start', color: '#7f93ad' },
};

export function ConversationFlowModal({ open, context, status, selectedMessageId, onClose, onSelectMessage }) {
  if (!open) return null;

  const loading = status === 'loading';
  const errored = status === 'error';

  const thread = (context && context.thread) || [];
  const selIdx = thread.findIndex(t => t.is_focus);
  const before = selIdx >= 0 ? selIdx : 0;
  const after = selIdx >= 0 ? thread.length - selIdx - 1 : 0;

  const sel = context && context.selected_message;
  const why = sel && sel.why_matters;

  const renderBubble = (item) => {
    const color = AGENTS[item.agent_id]?.color || '#5a7a9a';
    const isSelf = !!item.is_focus;
    const isReply = !isSelf && (item.reply_kind === 'direct' || item.reply_kind === 'addressed');
    const tag = KIND_TAG[item.reply_kind] || null;
    return (
      <div
        key={item.message_id}
        className={`chat-bubble${isSelf ? ' selected' : ''}${isReply ? ' is-reply' : ''}`}
        style={{ '--agent-color': color }}
        onClick={() => item.message_id !== selectedMessageId && onSelectMessage && onSelectMessage(item.message_id)}
        title={isSelf ? 'Focused message' : 'Click to focus this message'}
      >
        <div className="cb-head">
          {isReply && <span className="cb-arrow" title="reply">↳</span>}
          <span className="cb-agent" style={{ color }}>{item.agent_label}</span>
          {item.comm_id != null && <span className="comm-id">#{item.comm_id}</span>}
          <span className="cb-ch">{item.channel}</span>
          <span className="cb-ts">{item.timestamp}</span>
          {tag && <span className="cb-kind" style={{ '--kind-color': tag.color }}>{tag.label}</span>}
          <span className={`cb-reason${isSelf ? ' is-sel' : ''}`}>{isSelf ? 'selected' : item.relation_reason}</span>
        </div>
        <div className="cb-body">{item.content}</div>
      </div>
    );
  };

  return (
    <div className="flow-overlay" onClick={onClose}>
      <div className="flow-modal" onClick={e => e.stopPropagation()}>
        <div className="flow-modal-head">
          <div>
            <h3>Conversation flow</h3>
            {sel && (
              <div className="flow-sub">
                Reconstructed from <code>responding_to</code> + <code>recipients</code> ·
                {' '}{thread.length} message{thread.length === 1 ? '' : 's'}
                {' '}({before} leading up, {after} reply{after === 1 ? '' : 'ies'})
              </div>
            )}
          </div>
          <button className="flow-close" onClick={onClose}>✕</button>
        </div>

        {!loading && !errored && why && <div className="flow-why"><b>Why this matters:</b> {why}</div>}

        {loading && (
          <p className="muted" style={{ padding: '8px 4px 8px 16px' }}>Loading conversation…</p>
        )}
        {errored && (
          <p className="muted" style={{ padding: '8px 4px 8px 16px' }}>Could not load this conversation (is the backend running?).</p>
        )}

        {!loading && !errored && (!context || !context.found) && (
          <p className="muted" style={{ padding: '8px 4px 8px 16px' }}>No message selected.</p>
        )}

        {!loading && !errored && context && context.found && thread.length <= 1 && (
          <p className="muted" style={{ padding: '8px 16px' }}>
            This message starts a thread on its own — nothing replies to it and it
            isn’t addressed to an earlier speaker.
          </p>
        )}

        <div className="flow-list">
          {!loading && !errored && thread.map(item => renderBubble(item))}
        </div>
      </div>
    </div>
  );
}
