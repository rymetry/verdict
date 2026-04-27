// Card primitive スモークテスト。構造プリミティブで logic は薄いため最低限の組み立て確認。
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from "@/components/ui/card";

describe("<Card />", () => {
  it("Header / Title / Description / Content / Footer を組み合わせて描画できる", () => {
    render(
      <Card>
        <CardHeader>
          <CardTitle>タイトル</CardTitle>
          <CardDescription>説明</CardDescription>
        </CardHeader>
        <CardContent>本文</CardContent>
        <CardFooter>フッタ</CardFooter>
      </Card>
    );
    expect(screen.getByText("タイトル")).toBeInTheDocument();
    expect(screen.getByText("説明")).toBeInTheDocument();
    expect(screen.getByText("本文")).toBeInTheDocument();
    expect(screen.getByText("フッタ")).toBeInTheDocument();
  });

  it("ルート要素はカード境界のクラスを持つ", () => {
    render(
      <Card data-testid="card">
        <CardContent>x</CardContent>
      </Card>
    );
    expect(screen.getByTestId("card")).toHaveClass("rounded-lg");
    expect(screen.getByTestId("card")).toHaveClass("border");
  });
});
