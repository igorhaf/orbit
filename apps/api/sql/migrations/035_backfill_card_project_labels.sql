INSERT INTO labels(board_id,name,color)
SELECT DISTINCT board.id,project.name,'green_dark'
FROM boards board
JOIN lists list ON list.board_id=board.id
JOIN cards card ON card.list_id=list.id AND card.archived_at IS NULL
JOIN ai_projects project ON project.id=COALESCE(card.ai_project_id,board.ai_default_project_id)
WHERE NOT EXISTS (
  SELECT 1 FROM labels label WHERE label.board_id=board.id AND label.name=project.name
);

DELETE FROM card_labels card_label
USING cards card,lists list,boards board,labels label
WHERE card_label.card_id=card.id
  AND card.list_id=list.id
  AND list.board_id=board.id
  AND card_label.label_id=label.id
  AND EXISTS (
    SELECT 1 FROM ai_projects known_project
    WHERE known_project.owner_id=board.owner_id AND known_project.name=label.name
  )
  AND NOT EXISTS (
    SELECT 1 FROM ai_projects effective_project
    WHERE effective_project.id=COALESCE(card.ai_project_id,board.ai_default_project_id)
      AND effective_project.name=label.name
  );

INSERT INTO card_labels(card_id,label_id)
SELECT card.id,label.id
FROM cards card
JOIN lists list ON list.id=card.list_id
JOIN boards board ON board.id=list.board_id
JOIN ai_projects project ON project.id=COALESCE(card.ai_project_id,board.ai_default_project_id)
JOIN labels label ON label.board_id=board.id AND label.name=project.name
WHERE card.archived_at IS NULL
ON CONFLICT DO NOTHING;
