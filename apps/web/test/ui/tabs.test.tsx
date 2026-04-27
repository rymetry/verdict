// Tabs primitive (Radix UI) の選択挙動テスト
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

function Sample() {
  return (
    <Tabs defaultValue="overview">
      <TabsList>
        <TabsTrigger value="overview">概要</TabsTrigger>
        <TabsTrigger value="failures">失敗</TabsTrigger>
      </TabsList>
      <TabsContent value="overview">概要パネル</TabsContent>
      <TabsContent value="failures">失敗パネル</TabsContent>
    </Tabs>
  );
}

describe("<Tabs />", () => {
  it("デフォルトでは overview パネルが表示される", () => {
    render(<Sample />);
    expect(screen.getByText("概要パネル")).toBeInTheDocument();
    expect(screen.queryByText("失敗パネル")).not.toBeInTheDocument();
  });

  it("Trigger をクリックするとパネルが切り替わる", async () => {
    render(<Sample />);
    await userEvent.click(screen.getByRole("tab", { name: "失敗" }));
    expect(screen.getByText("失敗パネル")).toBeInTheDocument();
  });

  it("ArrowRight キーで次のタブへフォーカスが移動して切替わる (a11y)", async () => {
    render(<Sample />);
    const overview = screen.getByRole("tab", { name: "概要" });
    overview.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByText("失敗パネル")).toBeInTheDocument();
  });
});
