-- Remove only unchanged snapshots produced by checklist conversion.
-- The original card remains linked through card_contexts; edited descriptions are preserved.
UPDATE cards converted
SET description='',updated_at=now()
FROM card_contexts ref JOIN cards source ON source.id=ref.context_card_id
WHERE converted.id=ref.card_id
  AND split_part(converted.description,E'\n',1) LIKE 'Convertido do checklist “%'
  AND right(split_part(converted.description,E'\n',1),length('” do cartão “'||source.title||'”.'))='” do cartão “'||source.title||'”.'
  AND converted.description=split_part(converted.description,E'\n',1)||
    CASE WHEN regexp_replace(source.description,'^\s+|\s+$','','g')<>''
      THEN E'\n\nContexto do cartão de origem:\n'||regexp_replace(source.description,'^\s+|\s+$','','g')
      ELSE '' END;
