"""DAG executor for Hive workflows.

Local Python module per architect's plugin-packaging lock; not in
plugin.json. The marketplace surface continues to be the existing
`/execute` skill, which will invoke this executor in a later slice
(hde-9a/hde-9b/hde-10). Schema evolution stays under maintainer control
until the surface is stable.
"""
