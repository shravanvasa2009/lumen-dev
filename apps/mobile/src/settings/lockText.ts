// Lock-screen strings read "Lumen · Status"; the widget previews draw the two parts on separate lines.
export function lockTextLines(text: string): { name: string; status: string } {
  const [name = '', ...rest] = text.split(' · ');
  return { name, status: rest.join(' · ') };
}
