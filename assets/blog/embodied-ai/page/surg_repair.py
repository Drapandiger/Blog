import sys

file_path = '/home/drapandiger/Project/Blog/assets/blog/embodied-ai/page/blog-embodied-ai.html'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# I will replace the messy block by finding specific unique strings.

# The messy block starts here:
prefix_to_remove = """                <div class="my-8 rounded-xl overflow-hidden border border-slate-800 shadow-lg bg-slate-900/50 p-6 text-center max-w-4xl mx-auto flex flex-col items-center">
                    <img src="../images/fig4.png" alt="LLM-Parameterized DFS Tree Execution"
                        class="w-full h-auto object-cover rounded-lg mb-4 hover:scale-[1.02] transition-transform duration-500">
                
<p class="text-sm text-slate-400 text-center mb-2">
 Figure 3: Hierarchical VLA Execution Architecture
</p>
<div class="my-8 rounded-xl overflow-hidden shadow-2xl border border-slate-700/50 bg-slate-800/20">
 <img alt="Hierarchical VLA Execution Architecture" class="w-full h-auto object-cover hover:scale-[1.02] transition-transform duration-500" src="../images/fig3.png"/>
</div>"""

replacement_for_prefix = """                
<div class="my-8 rounded-xl overflow-hidden border border-slate-800 shadow-lg bg-slate-900/50 p-6 text-center max-w-4xl mx-auto flex flex-col items-center">
 <img alt="Hierarchical VLA Execution Architecture" class="w-full h-auto object-cover rounded-lg mb-4 hover:scale-[1.02] transition-transform duration-500" src="../images/fig3.png"/>
 <p class="text-sm text-slate-400 text-center mb-2">
  Figure 3: Hierarchical VLA Execution Architecture
 </p>
</div>"""

if prefix_to_remove in content:
    content = content.replace(prefix_to_remove, replacement_for_prefix)
else:
    print("Could not find the prefix block.")
    sys.exit(1)


# The end of the block has:
suffix_to_replace = """<p class="text-sm text-slate-400 text-center mb-2">
 Figure 4: LLM-Parameterized Depth-First Search (DFS) Tree Execution
</p>
                </div>"""

replacement_for_suffix = """<div class="my-8 rounded-xl overflow-hidden border border-slate-800 shadow-lg bg-slate-900/50 p-6 text-center max-w-4xl mx-auto flex flex-col items-center">
 <img src="../images/fig4.png" alt="LLM-Parameterized DFS Tree Execution" class="w-full h-auto object-cover rounded-lg mb-4 hover:scale-[1.02] transition-transform duration-500">
 <p class="text-sm text-slate-400 text-center mb-2">
  Figure 4: LLM-Parameterized Depth-First Search (DFS) Tree Execution
 </p>
</div>"""

if suffix_to_replace in content:
    content = content.replace(suffix_to_replace, replacement_for_suffix)
else:
    print("Could not find the suffix block.")
    sys.exit(1)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("Repair completed successfully!")
