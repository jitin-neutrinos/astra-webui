export async function copyText(s: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(s);
    return true;
  } catch (e) {
    try {
      const textarea = document.createElement("textarea");
      textarea.value = s;
      textarea.style.position = "absolute";
      textarea.style.left = "-9999px";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      return true;
    } catch (err) {
      return false;
    }
  }
}
