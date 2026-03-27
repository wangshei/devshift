import React, { useState } from 'react';

function getLevel(count) {
  if (!count || count === 0) return 0;
  if (count <= 2) return 1;
  return 2;
}

function generateDaySlots(days) {
  const slots = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    slots.push(d.toISOString().split('T')[0]);
  }
  return slots;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function ActivityGrid({ data = [], days = 30, onDayClick }) {
  const daySlots = generateDaySlots(days);
  const dataMap = {};
  let maxCount = 1;
  for (const d of data) {
    dataMap[d.day] = d;
    if (d.total > maxCount) maxCount = d.total;
  }

  // WEEK VIEW — bar chart
  if (days <= 7) {
    return (
      <div className="flex items-end gap-2 h-32">
        {daySlots.map(day => {
          const d = dataMap[day];
          const count = d?.total || 0;
          const height = count > 0 ? Math.max(8, (count / maxCount) * 100) : 4;
          const date = new Date(day + 'T00:00:00');
          const dayLabel = WEEKDAYS[date.getDay()];
          return (
            <div key={day} className="flex-1 flex flex-col items-center gap-1">
              <div className="flex-1 w-full flex flex-col justify-end">
                {count > 0 && (
                  <span className="text-[10px] font-mono text-muted text-center mb-0.5">{count}</span>
                )}
                <div
                  className={`w-full rounded-t transition-all ${count > 0 ? 'bg-accent' : 'bg-border'}`}
                  style={{ height: `${height}%`, minHeight: count > 0 ? '8px' : '2px' }}
                  title={`${day}: ${count} tasks (${d?.succeeded || 0} ok, ${d?.failed || 0} failed)`}
                />
              </div>
              <span className="text-[9px] text-vmuted font-mono">{dayLabel}</span>
            </div>
          );
        })}
      </div>
    );
  }

  // MONTH VIEW — calendar grid with clickable dates
  if (days <= 31) {
    const [selected, setSelected] = useState(null);
    const firstDate = new Date(daySlots[0] + 'T00:00:00');
    const startDay = firstDate.getDay();

    // Build weeks
    const cells = [];
    for (let i = 0; i < startDay; i++) cells.push(null);
    for (const day of daySlots) cells.push(day);
    while (cells.length % 7 !== 0) cells.push(null);

    const weeks = [];
    for (let i = 0; i < cells.length; i += 7) {
      weeks.push(cells.slice(i, i + 7));
    }

    const handleClick = (day) => {
      setSelected(selected === day ? null : day);
      onDayClick?.(day);
    };

    const LEVELS = ['bg-border', 'bg-success/40', 'bg-success'];

    return (
      <div>
        {/* Day headers */}
        <div className="grid grid-cols-7 gap-1 mb-1">
          {WEEKDAYS.map(d => (
            <span key={d} className="text-[9px] text-vmuted font-mono text-center">{d}</span>
          ))}
        </div>
        {/* Calendar */}
        <div className="grid grid-cols-7 gap-1">
          {weeks.flat().map((day, i) => {
            if (!day) return <div key={`empty-${i}`} className="aspect-square" />;
            const d = dataMap[day];
            const level = getLevel(d?.total);
            const dateNum = parseInt(day.slice(8));
            const isSelected = selected === day;
            return (
              <button
                key={day}
                onClick={() => handleClick(day)}
                className={`aspect-square rounded text-[10px] font-mono flex items-center justify-center transition-all ${
                  isSelected ? 'ring-2 ring-accent' : ''
                } ${d?.total ? LEVELS[level] + ' text-white' : 'bg-hover text-vmuted hover:bg-border'}`}
                title={`${day}: ${d?.total || 0} tasks`}
              >
                {dateNum}
              </button>
            );
          })}
        </div>
        {/* Selected day detail */}
        {selected && dataMap[selected] && (
          <div className="mt-2 p-2 bg-bg border border-border rounded-lg text-xs font-mono">
            <span className="text-text">{selected}</span>:
            <span className="text-success ml-2">{dataMap[selected].succeeded} completed</span>
            {dataMap[selected].failed > 0 && <span className="text-error ml-2">{dataMap[selected].failed} failed</span>}
            <span className="text-vmuted ml-2">{Math.round(dataMap[selected].credits || 0)} credits</span>
          </div>
        )}
      </div>
    );
  }

  // YEAR VIEW — GitHub-style grid
  const LEVELS = ['bg-border', 'bg-success/40', 'bg-success'];
  const weeks = [];
  let currentWeek = [];
  const firstDate = new Date(daySlots[0] + 'T00:00:00');
  for (let i = 0; i < firstDate.getDay(); i++) currentWeek.push(null);
  for (const day of daySlots) {
    currentWeek.push(day);
    if (currentWeek.length === 7) { weeks.push(currentWeek); currentWeek = []; }
  }
  if (currentWeek.length > 0) {
    while (currentWeek.length < 7) currentWeek.push(null);
    weeks.push(currentWeek);
  }

  return (
    <div className="flex gap-[2px] overflow-x-auto">
      {weeks.map((week, wi) => (
        <div key={wi} className="flex flex-col gap-[2px]">
          {week.map((day, di) => {
            if (!day) return <div key={di} className="w-3 h-3" />;
            const d = dataMap[day];
            const level = getLevel(d?.total);
            return (
              <div
                key={day}
                className={`w-3 h-3 rounded-sm ${LEVELS[level]}`}
                title={`${day}: ${d?.total || 0} tasks`}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}
