# market-lens-frontend-review

## 目的

Market Lens AI の UI を public-facing SaaS / デモとして耐える品質でレビューする skill。

## いつ使うか

- フロントエンドの変更をレビューするとき
- UI redesign の品質を判定するとき
- mobile / tablet / desktop の表示確認をするとき

## レビュー観点

### 情報設計
- 1st view で「何ができるか」が伝わるか
- scan workspace と result reading experience が分離されているか
- CTA / report / history への導線が明確か

### ビジュアル品質
- generic dark dashboard に落ちていないか
- design tokens（色、spacing、typography）が一貫しているか
- loading / empty / error state が定義されているか

### レスポンシブ
- mobile (375px) で主要操作が可能か
- tablet (768px) でレイアウトが破綻しないか
- desktop (1440px) で余白が適切か

### アクセシビリティ
- contrast ratio が WCAG AA を満たすか
- keyboard 操作が最低限通るか
- focus indicator が視認できるか

### セキュリティ
- `innerHTML` に未サニタイズ文字列が入っていないか
- Markdown 表示が `DOMPurify.sanitize(marked.parse())` を通しているか
- ユーザー入力が DOM に直接挿入されていないか

## 合格基準

- desktop と mobile の両方で主要操作（URL入力、スキャン実行、レポート閲覧、履歴確認）が可能
- demo screenshot を社外に見せられる品質
- `npm run build` が通る
