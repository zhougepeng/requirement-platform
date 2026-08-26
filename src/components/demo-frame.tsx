export function DemoFrame({ viewport, src }: { viewport: "desktop" | "mobile"; src: string }) {
  return (
    <div className={`demo-stage ${viewport === "mobile" ? "is-mobile" : ""}`}>
      <iframe
        title="图片转采购单 Demo"
        className="demo-frame"
        sandbox="allow-scripts allow-forms"
        src={src}
      />
    </div>
  );
}
