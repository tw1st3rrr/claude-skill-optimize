# /optimize — скилл для Claude Code

Переписывает сырую формулировку задачи в более полную и конкретную, опираясь на persistent memory и контекст текущего проекта (CLAUDE.md, git, релевантные файлы). Показывает получившийся промпт, сразу выполняет его и по итогам обновляет память.

Вызывается только вручную: `/optimize <текст задачи>`.

## Установка

```bash
git clone https://github.com/tw1st3rrr/claude-skill-optimize.git
cp -r claude-skill-optimize/optimize ~/.claude/skills/
```

На Windows папка скиллов: `%USERPROFILE%\.claude\skills\`. После копирования перезапусти Claude Code.
