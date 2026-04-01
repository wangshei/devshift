import React from 'react';

/**
 * Lightweight markdown renderer — handles bold, italic, code, code blocks, and line breaks.
 * No external dependencies.
 */
export default function Markdown({ text, className = '' }) {
  if (!text) return null;

  // Split by code blocks first
  const parts = text.split(/(```[\s\S]*?```)/g);

  return (
    <div className={`space-y-1 ${className}`}>
      {parts.map((part, i) => {
        // Code block
        if (part.startsWith('```')) {
          const code = part.replace(/^```\w*\n?/, '').replace(/\n?```$/, '');
          return (
            <pre key={i} className="bg-bg border border-border rounded px-3 py-2 text-[11px] font-mono overflow-x-auto whitespace-pre-wrap">
              {code}
            </pre>
          );
        }

        // Regular text — process inline markdown
        return (
          <div key={i}>
            {part.split('\n').map((line, j) => (
              <p key={j} className={line.trim() ? '' : 'h-2'}>
                {renderInline(line)}
              </p>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function renderInline(text) {
  if (!text) return null;

  // Process inline patterns: **bold**, *italic*, `code`
  const parts = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    // Bold: **text**
    const boldMatch = remaining.match(/^(.*?)\*\*(.+?)\*\*(.*)/s);
    if (boldMatch) {
      if (boldMatch[1]) parts.push(<span key={key++}>{boldMatch[1]}</span>);
      parts.push(<strong key={key++} className="font-semibold">{boldMatch[2]}</strong>);
      remaining = boldMatch[3];
      continue;
    }

    // Inline code: `text`
    const codeMatch = remaining.match(/^(.*?)`(.+?)`(.*)/s);
    if (codeMatch) {
      if (codeMatch[1]) parts.push(<span key={key++}>{codeMatch[1]}</span>);
      parts.push(<code key={key++} className="bg-bg border border-border rounded px-1 py-0.5 text-[11px] font-mono">{codeMatch[2]}</code>);
      remaining = codeMatch[3];
      continue;
    }

    // Italic: *text*
    const italicMatch = remaining.match(/^(.*?)\*(.+?)\*(.*)/s);
    if (italicMatch) {
      if (italicMatch[1]) parts.push(<span key={key++}>{italicMatch[1]}</span>);
      parts.push(<em key={key++}>{italicMatch[2]}</em>);
      remaining = italicMatch[3];
      continue;
    }

    // No more patterns — output remaining text
    parts.push(<span key={key++}>{remaining}</span>);
    break;
  }

  return parts;
}
