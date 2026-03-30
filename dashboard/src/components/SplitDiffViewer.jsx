import React, { useState, useRef, useMemo, useCallback, useEffect } from 'react';

/**
 * Parse a unified diff string into structured file diffs.
 * Each file diff contains hunks, and each hunk contains lines with metadata.
 */
function parseDiff(diffStr) {
  if (!diffStr) return [];

  const lines = diffStr.split('\n');
  const files = [];
  let currentFile = null;
  let currentHunk = null;
  let leftLine = 0;
  let rightLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // New file header
    if (line.startsWith('diff --git')) {
      if (currentHunk && currentFile) currentFile.hunks.push(currentHunk);
      if (currentFile) files.push(currentFile);
      currentFile = { filename: '', hunks: [] };
      currentHunk = null;
      continue;
    }

    // Extract filename from +++ line
    if (line.startsWith('+++ ')) {
      if (currentFile) {
        const name = line.slice(4);
        currentFile.filename = name.startsWith('b/') ? name.slice(2) : name;
      }
      continue;
    }

    if (line.startsWith('--- ')) continue;

    // Hunk header
    if (line.startsWith('@@')) {
      if (currentHunk && currentFile) currentFile.hunks.push(currentHunk);
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)/);
      leftLine = match ? parseInt(match[1], 10) : 1;
      rightLine = match ? parseInt(match[2], 10) : 1;
      currentHunk = { header: line, lines: [] };
      continue;
    }

    if (!currentHunk) continue;

    if (line.startsWith('+')) {
      currentHunk.lines.push({ type: 'add', content: line.slice(1), leftNum: null, rightNum: rightLine++ });
    } else if (line.startsWith('-')) {
      currentHunk.lines.push({ type: 'remove', content: line.slice(1), leftNum: leftLine++, rightNum: null });
    } else if (line.startsWith('\\')) {
      // "\ No newline at end of file"
      currentHunk.lines.push({ type: 'info', content: line, leftNum: null, rightNum: null });
    } else {
      // Context line (starts with space or is empty)
      currentHunk.lines.push({ type: 'context', content: line.startsWith(' ') ? line.slice(1) : line, leftNum: leftLine++, rightNum: rightLine++ });
    }
  }

  if (currentHunk && currentFile) currentFile.hunks.push(currentHunk);
  if (currentFile) files.push(currentFile);

  return files;
}

/**
 * Pair up lines for side-by-side display.
 * Adjacent remove+add sequences become paired rows; context lines appear on both sides.
 */
function pairLines(hunkLines) {
  const rows = [];
  let i = 0;

  while (i < hunkLines.length) {
    const line = hunkLines[i];

    if (line.type === 'context' || line.type === 'info') {
      rows.push({ left: line, right: line, type: line.type });
      i++;
    } else if (line.type === 'remove') {
      // Collect consecutive removes, then consecutive adds
      const removes = [];
      while (i < hunkLines.length && hunkLines[i].type === 'remove') {
        removes.push(hunkLines[i]);
        i++;
      }
      const adds = [];
      while (i < hunkLines.length && hunkLines[i].type === 'add') {
        adds.push(hunkLines[i]);
        i++;
      }
      const maxLen = Math.max(removes.length, adds.length);
      for (let j = 0; j < maxLen; j++) {
        rows.push({
          left: j < removes.length ? removes[j] : null,
          right: j < adds.length ? adds[j] : null,
          type: 'change',
        });
      }
    } else if (line.type === 'add') {
      rows.push({ left: null, right: line, type: 'change' });
      i++;
    } else {
      i++;
    }
  }

  return rows;
}

/**
 * Group rows into segments: either a "change" segment or a "context" segment.
 * Context segments with more than `threshold` lines get collapsed.
 */
function groupRows(rows, threshold = 4) {
  const segments = [];
  let current = null;

  for (const row of rows) {
    const isContext = row.type === 'context';
    if (!current || current.isContext !== isContext) {
      if (current) segments.push(current);
      current = { isContext, rows: [] };
    }
    current.rows.push(row);
  }
  if (current) segments.push(current);

  return segments.map(seg => ({
    ...seg,
    collapsible: seg.isContext && seg.rows.length > threshold,
  }));
}

/** Collapsible context region */
function CollapsibleContext({ segment, isSplit }) {
  const [expanded, setExpanded] = useState(false);

  if (expanded) {
    return segment.rows.map((row, i) => (
      <SplitRow key={i} row={row} isSplit={isSplit} />
    ));
  }

  return (
    <tr>
      <td colSpan={isSplit ? 4 : 3} className="text-center py-1">
        <button
          onClick={() => setExpanded(true)}
          className="text-[10px] text-accent hover:text-text transition-colors font-mono px-2 py-0.5"
        >
          Show {segment.rows.length} hidden lines
        </button>
      </td>
    </tr>
  );
}

function lineClass(type) {
  if (type === 'remove') return 'bg-error/10 text-error';
  if (type === 'add') return 'bg-success/10 text-success';
  return 'text-muted';
}

function SplitRow({ row, isSplit }) {
  if (!isSplit) {
    // Unified view
    const line = row.right || row.left;
    if (!line) return null;
    const prefix = line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' ';
    return (
      <tr className={line.type === 'add' ? 'bg-success/5' : line.type === 'remove' ? 'bg-error/5' : ''}>
        <td className="px-2 text-right text-vmuted select-none w-8 text-[10px] align-top">{line.leftNum ?? ''}</td>
        <td className="px-2 text-right text-vmuted select-none w-8 text-[10px] align-top">{line.rightNum ?? ''}</td>
        <td className={`px-2 whitespace-pre-wrap break-all ${lineClass(line.type)}`}>
          <span className="select-none">{prefix}</span>{line.content}
        </td>
      </tr>
    );
  }

  // Split view
  return (
    <tr>
      <td className="px-2 text-right text-vmuted select-none w-10 text-[10px] align-top border-r border-border/30">
        {row.left?.leftNum ?? ''}
      </td>
      <td className={`px-2 whitespace-pre-wrap break-all border-r border-border/50 w-1/2 ${
        row.left ? lineClass(row.left.type) : 'text-muted'
      } ${row.left?.type === 'remove' ? 'bg-error/5' : ''}`}>
        {row.left?.content ?? ''}
      </td>
      <td className="px-2 text-right text-vmuted select-none w-10 text-[10px] align-top border-r border-border/30">
        {row.right?.rightNum ?? ''}
      </td>
      <td className={`px-2 whitespace-pre-wrap break-all w-1/2 ${
        row.right ? lineClass(row.right.type) : 'text-muted'
      } ${row.right?.type === 'add' ? 'bg-success/5' : ''}`}>
        {row.right?.content ?? ''}
      </td>
    </tr>
  );
}

function FileBlock({ file, isSplit, hunkRefs, hunkIndexOffset }) {
  return (
    <div className="border border-border rounded-lg overflow-hidden">
      {/* File header */}
      <div className="px-3 py-1.5 bg-bg border-b border-border flex items-center gap-2">
        <span className="text-[10px] font-mono text-accent">
          {file.filename || 'unknown file'}
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-[11px] font-mono leading-relaxed border-collapse">
          <tbody>
            {file.hunks.map((hunk, hIdx) => {
              const globalIdx = hunkIndexOffset + hIdx;
              const paired = pairLines(hunk.lines);
              const segments = groupRows(paired);

              return (
                <React.Fragment key={hIdx}>
                  {/* Hunk header */}
                  <tr ref={el => { if (hunkRefs) hunkRefs.current[globalIdx] = el; }}>
                    <td
                      colSpan={isSplit ? 4 : 3}
                      className="px-3 py-1 text-accent bg-accent/5 text-[10px] font-mono"
                    >
                      {hunk.header}
                    </td>
                  </tr>
                  {segments.map((seg, sIdx) =>
                    seg.collapsible ? (
                      <CollapsibleContext key={`s-${sIdx}`} segment={seg} isSplit={isSplit} />
                    ) : (
                      seg.rows.map((row, rIdx) => (
                        <SplitRow key={`r-${sIdx}-${rIdx}`} row={row} isSplit={isSplit} />
                      ))
                    )
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * SplitDiffViewer - A side-by-side diff viewer component.
 *
 * @param {Object} props
 * @param {string} props.diff - Unified diff string (git diff output)
 * @param {string} [props.stat] - Diff stat string
 */
export default function SplitDiffViewer({ diff, stat }) {
  const containerRef = useRef(null);
  const hunkRefs = useRef([]);
  const [currentHunk, setCurrentHunk] = useState(-1);
  const [isSplit, setIsSplit] = useState(true);

  const files = useMemo(() => parseDiff(diff), [diff]);

  // Total hunks count and offset map
  const { totalHunks, hunkOffsets } = useMemo(() => {
    let total = 0;
    const offsets = [];
    for (const file of files) {
      offsets.push(total);
      total += file.hunks.length;
    }
    return { totalHunks: total, hunkOffsets: offsets };
  }, [files]);

  // Responsive: detect narrow viewport
  useEffect(() => {
    const mql = window.matchMedia('(max-width: 768px)');
    const handler = (e) => setIsSplit(!e.matches);
    handler(mql);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  const jumpToHunk = useCallback((direction) => {
    if (totalHunks === 0) return;
    let next;
    if (direction === 'next') {
      next = currentHunk + 1 >= totalHunks ? 0 : currentHunk + 1;
    } else {
      next = currentHunk - 1 < 0 ? totalHunks - 1 : currentHunk - 1;
    }
    setCurrentHunk(next);
    const el = hunkRefs.current[next];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [currentHunk, totalHunks]);

  if (!diff) {
    return (
      <div className="border-t border-border">
        {stat && (
          <div className="px-4 py-2 bg-bg text-xs font-mono text-muted">{stat}</div>
        )}
        <div className="px-4 py-3 text-xs text-vmuted">No changes found on this branch.</div>
      </div>
    );
  }

  return (
    <div className="border-t border-border" ref={containerRef}>
      {/* Stat bar */}
      {stat && (
        <div className="px-4 py-2 bg-bg text-xs font-mono text-muted">{stat}</div>
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-bg">
        <button
          onClick={() => jumpToHunk('prev')}
          className="px-2 py-1 text-[10px] font-mono text-muted hover:text-text bg-card border border-border rounded transition-colors"
          title="Previous diff"
        >
          Prev
        </button>
        <button
          onClick={() => jumpToHunk('next')}
          className="px-2 py-1 text-[10px] font-mono text-muted hover:text-text bg-card border border-border rounded transition-colors"
          title="Next diff"
        >
          Next
        </button>
        <span className="text-[10px] font-mono text-vmuted">
          {totalHunks} hunk{totalHunks !== 1 ? 's' : ''} in {files.length} file{files.length !== 1 ? 's' : ''}
        </span>
        <div className="flex-1" />
        <button
          onClick={() => setIsSplit(!isSplit)}
          className="px-2 py-1 text-[10px] font-mono text-muted hover:text-text bg-card border border-border rounded transition-colors"
        >
          {isSplit ? 'Unified' : 'Split'}
        </button>
      </div>

      {/* Diff content */}
      <div className="max-h-[70vh] overflow-y-auto overflow-x-auto p-3 space-y-3">
        {files.map((file, fIdx) => (
          <FileBlock
            key={fIdx}
            file={file}
            isSplit={isSplit}
            hunkRefs={hunkRefs}
            hunkIndexOffset={hunkOffsets[fIdx]}
          />
        ))}
      </div>
    </div>
  );
}
