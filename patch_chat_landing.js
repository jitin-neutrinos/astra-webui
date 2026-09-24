const fs = require('fs');
let content = fs.readFileSync('src/components/chat-landing.tsx', 'utf8');

const targetStr = `{errorBanner}
        </div>`;
const replacementStr = `{errorBanner}
          {!isStreaming && lastPromptRef.current && (
            <button type="button" onClick={retry} className="ml-1 underline decoration-dotted underline-offset-2 hover:text-red-300 font-mono">retry</button>
          )}
        </div>`;

content = content.replace(targetStr, replacementStr);
fs.writeFileSync('src/components/chat-landing.tsx', content);
