// 基盤プリミティブの動作確認ページ。?foundation=1 で有効化される。
// - β/γ 移行前に Tailwind トークン + shadcn primitives がライト/ダーク両モードで
//   正しく描画されるかを目視確認するための簡易プレビュー。
// - Storybook を導入する代わりに最小限のページとして同梱 (YAGNI)。
import { Sun, Moon, MonitorSmartphone } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from "@/components/ui/tooltip";
import { useTheme, isThemePreference } from "@/hooks/use-theme";

export function FoundationPreview(): React.ReactElement {
  const { theme, resolvedTheme, setTheme } = useTheme();
  return (
    <TooltipProvider delayDuration={150}>
      <div className="min-h-screen bg-[var(--bg-0)] text-[var(--ink-0)]">
        <header className="border-b border-[var(--line)] bg-[var(--bg-overlay)] px-6 py-4 backdrop-blur">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-3)]">
                Workbench / Foundation Preview
              </p>
              <h1 className="mt-1 text-xl font-semibold">
                Tailwind v4 + shadcn/ui (v10 Balanced Green)
              </h1>
            </div>
            <ToggleGroup
              type="single"
              value={theme}
              onValueChange={(value) => {
                // Radix ToggleGroup は単一選択モードでも、現在値の Item を再クリックすると
                // 空文字 ("") を返す (deselect)。本アプリでは "deselected テーマ" を許さない
                // ため、許容 3 値に該当しない場合は前値を維持する。
                if (isThemePreference(value)) {
                  setTheme(value);
                }
              }}
              aria-label="テーマ切替"
            >
              <ToggleGroupItem value="light" aria-label="ライトモード">
                <Sun aria-hidden /> ライト
              </ToggleGroupItem>
              <ToggleGroupItem value="auto" aria-label="自動">
                <MonitorSmartphone aria-hidden /> 自動
              </ToggleGroupItem>
              <ToggleGroupItem value="dark" aria-label="ダークモード">
                <Moon aria-hidden /> ダーク
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
        </header>

        <main className="mx-auto max-w-5xl space-y-8 px-6 py-8">
          <Card>
            <CardHeader>
              <CardTitle>Buttons</CardTitle>
              <CardDescription>
                CTA はモード横断で同じダークグリーン。アクセントは light/dark で明度を変える。
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-3">
              <Button>再実行</Button>
              <Button variant="outline">キャンセル</Button>
              <Button variant="ghost">ログを開く</Button>
              <Button variant="destructive">削除</Button>
              <Button variant="link">詳細</Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Status badges</CardTitle>
              <CardDescription>
                色相分離 (pass=142° / fail=27° / flaky=75° / accent=156°) で識別性を確保。
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Badge variant="pass">合格 24</Badge>
              <Badge variant="fail">失敗 3</Badge>
              <Badge variant="flaky">flaky 2</Badge>
              <Badge variant="skip">スキップ 1</Badge>
              <Badge variant="info">情報</Badge>
              <Badge variant="accent">ブランド</Badge>
              <Badge variant="outline">中立</Badge>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Tabs / Tooltip</CardTitle>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="overview" className="w-full">
                <TabsList>
                  <TabsTrigger value="overview">概要</TabsTrigger>
                  <TabsTrigger value="failures">失敗</TabsTrigger>
                  <TabsTrigger value="trace">trace</TabsTrigger>
                </TabsList>
                <TabsContent value="overview" className="text-sm text-[var(--ink-2)]">
                  概要タブの内容 (プレースホルダ)。
                </TabsContent>
                <TabsContent value="failures" className="text-sm text-[var(--ink-2)]">
                  失敗一覧 (プレースホルダ)。
                </TabsContent>
                <TabsContent value="trace" className="text-sm text-[var(--ink-2)]">
                  Trace 一覧 (プレースホルダ)。
                </TabsContent>
              </Tabs>
              <div className="mt-4">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="outline" size="sm">
                      ホバーで Tooltip
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Radix UI 経由のツールチップ</TooltipContent>
                </Tooltip>
              </div>
            </CardContent>
          </Card>

          <Alert variant="info">
            <AlertTitle>表示モード: {resolvedTheme} (選好: {theme})</AlertTitle>
            <AlertDescription>
              auto は OS の prefers-color-scheme を参照します。値は localStorage に永続化されます。
            </AlertDescription>
          </Alert>
        </main>
      </div>
    </TooltipProvider>
  );
}
