const statusLabels = {
  idle: 'Descansando', working: 'Trabalhando', reading: 'Lendo', tool: 'Usando ferramenta',
  waiting: 'Aguardando você', completed: 'Concluído', interrupted: 'Interrompido',
  error: 'Precisa de ajuda', offline: 'Desconectado'
};

export function taskBubbleText(robot) {
  const state = statusLabels[robot.status] ?? 'Sem sinal';
  const title = robot.title?.trim();
  if (!title) return state;
  if (!robot.description) return title.slice(0, 30);
  return `${state} · ${title.slice(0, 20)}`;
}
