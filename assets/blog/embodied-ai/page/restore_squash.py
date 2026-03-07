import bs4

file_path = '/home/drapandiger/Project/Blog/assets/blog/embodied-ai/page/blog-embodied-ai.html'
with open(file_path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

squashed_index = -1
for i, line in enumerate(lines):
    if len(line) > 2000 and "Figure 3:" in line and "Figure 4:" in line:
        squashed_index = i
        break

if squashed_index != -1:
    squashed_text = lines[squashed_index]
    # The squashed text is inside <p class="text-sm text-slate-400"> ... </p>
    # We need to extract the content, which is the actual HTML that was squashed.
    prefix = '<p class="text-sm text-slate-400">'
    suffix = '</p>'
    start_idx = squashed_text.find(prefix) + len(prefix)
    end_idx = squashed_text.rfind(suffix)
    
    html_content = squashed_text[start_idx:end_idx]
    
    # We know that the squashed content actually contains <p>Figure 3...</p> ... <p>Figure 4...</p>
    # Note that my previous bad regex:
    # r'<p class="text-sm text-slate-400 text-center mb-2">(Figure \d+:.*?)</p>\s*'
    # matched <p class="...">Figure 3... and captured EVERYTHING inside group 1, up to Figure 4.
    # So html_content is EXACTLY:
    # "Figure 3: Hierarchical VLA Execution Architecture</p> <div class... >... <p class="...">Figure 4: LLM-Parameterized Depth-First Search (DFS) Tree Execution"
    # Note that the opening <p class="..."> for Figure 3 was NOT captured in group 1, only the text!
    # And the closing </p> of Figure 4 was ALSO NOT captured, because it matched `.*?` up to `</p>\s*<div ... fig4>`.
    
    # So to restore it perfectly:
    restored_raw = f'<p class="text-sm text-slate-400 text-center mb-2">{html_content}</p>'
    
    # Let's use bs4 to format it nicely
    soup = bs4.BeautifulSoup(restored_raw, 'html.parser')
    pretty_html = soup.prettify()
    
    # Replace the gigantic line with pretty_html
    lines[squashed_index] = pretty_html + '\n'
    
    with open(file_path, 'w', encoding='utf-8') as f:
        f.writelines(lines)
    print(f"Restored squashed line at index {squashed_index}.")
else:
    print("Could not find the squashed line.")
