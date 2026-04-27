// app-shell (top bar + statusbar) の公開バレル。
// shell の構成要素はバレル経由で import して呼び出し側のコンパクト化を図る。
//
// 命名: 「shell」は UI シェル / アプリケーションフレームの意。
//      Playwright がクロスブラウザツールであるため、Chrome ブラウザと混同しやすい
//      "chrome" を避けて採用した (PR #17 レビュー時の指摘反映)。
export { Brand } from "./Brand";
export { Breadcrumbs } from "./Breadcrumbs";
export { PersonaToggle } from "./PersonaToggle";
export { RerunButton } from "./RerunButton";
export { ShellAlert } from "./ShellAlert";
export { StatusBar } from "./StatusBar";
export { ThemeToggle } from "./ThemeToggle";
export { TopBar } from "./TopBar";
export { agentDotColorClass, runStatusBadgeVariant, runStatusLabel } from "./status";
export type { AgentDotState } from "./status";
