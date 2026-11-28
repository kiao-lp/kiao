-- Cards remember the dimensions a person dragged their edges to. The width is always part of a
-- stored size; the height is optional, because a card whose height nobody dragged keeps growing
-- with its wrapped text.
ALTER TABLE flow_node
    ADD COLUMN size_w integer,
    ADD COLUMN size_h integer,
    ADD CONSTRAINT flow_node_size_positive
        CHECK ((size_w IS NULL OR size_w > 0) AND (size_h IS NULL OR size_h > 0));

COMMENT ON COLUMN flow_node.size_w IS 'Resized width in canvas pixels; NULL keeps the kind''s default.';
COMMENT ON COLUMN flow_node.size_h IS 'Resized height in canvas pixels; NULL keeps the natural height.';

ALTER TABLE flow_node_class
    ADD COLUMN size_w integer,
    ADD COLUMN size_h integer,
    ADD CONSTRAINT flow_node_class_size_positive
        CHECK ((size_w IS NULL OR size_w > 0) AND (size_h IS NULL OR size_h > 0));

COMMENT ON COLUMN flow_node_class.size_w IS 'Resized width in canvas pixels; NULL keeps the kind''s default.';
COMMENT ON COLUMN flow_node_class.size_h IS 'Resized height in canvas pixels; NULL keeps the natural height.';
