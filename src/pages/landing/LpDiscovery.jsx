import LpFeaturePage from './components/LpFeaturePage'

export default function LpDiscovery() {
  return (
    <LpFeaturePage
      eyebrow="競合候補の発見"
      icon="travel_explore"
      title="競合候補を、"
      highlight="根拠URLと一緒に。"
      description="入力したサイトと公開情報から候補を集め、直接競合、隣接競合、参考サイトに分けて確認します。最終判断は人が根拠を見て行います。"
      image="/imagegen/data-to-action-paper-collage.webp"
      imageAlt="散らばった情報を3段階で整理する紙コラージュ"
      primaryLabel="競合発見画面を開く"
      primaryTo="/discovery"
      cards={[
        { icon: 'language', title: '候補を収集', body: '入力URLと公開ページをもとに、比較対象になり得るサイトを提示します。' },
        { icon: 'account_tree', title: '関係を分類', body: '直接競合、隣接競合、参考サイトを混ぜずに分けて表示します。' },
        { icon: 'link', title: '根拠URLを確認', body: '候補名だけでなく、判断に使った公開ページへ戻って確認できます。' },
      ]}
      steps={[
        { title: '基準サイトを入力', body: '自社サイトまたは比較の基準にするURLを指定します。' },
        { title: '候補を生成', body: '設定したAIキーで候補と分類理由を整理します。' },
        { title: '人が採用を判断', body: '根拠ページを確認し、分析対象に含める候補だけを選びます。' },
      ]}
      noteTitle="リアルタイム監視機能ではありません"
      note="現在は実行時に公開情報を確認する競合候補の発見機能です。常時監視、自動通知、市場シェア、広告費推定は提供済み機能として扱いません。"
    />
  )
}
