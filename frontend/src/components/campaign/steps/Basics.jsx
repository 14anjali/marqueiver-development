import { SectionCard, Field, ChipGroup } from '../../profile/shared';
import { SelectField, CampaignImages, SubGroup } from '../wizard';
import { OBJECTIVES, CATEGORIES } from '../vocab';

/**
 * Section A — what the campaign is.
 *
 * The four fields a creator reads first, and the imagery they see beside them.
 * `title` and `brief` are the campaign's existing name and description fields;
 * nothing new was added for them.
 */
export default function Basics({ value, patch, errors = {} }) {
  const toggleTag = (t) => {
    const list = value.tags ?? [];
    patch({ tags: list.includes(t) ? list.filter((x) => x !== t) : [...list, t] });
  };

  return (
    <div className="space-y-5">
      <SectionCard
        title="Basic information"
        description="What the campaign is, and what you want it to achieve."
      >
        <div className="space-y-5">
          <Field
            id="cw-title"
            label="Campaign name"
            value={value.title}
            onChange={(v) => patch({ title: v })}
            error={errors.title}
            placeholder="Monsoon hair care launch"
            maxLength={120}
            hint="Creators see this first, in the campaign list."
          />

          <div className="grid sm:grid-cols-2 gap-5">
            <SelectField
              id="cw-category"
              label="Category"
              value={value.category}
              onChange={(v) => patch({ category: v })}
              options={CATEGORIES}
              error={errors.category}
              hint="Used to match your campaign with creators in that space."
            />
            <SelectField
              id="cw-objective"
              label="Objective"
              value={value.objective}
              onChange={(v) => patch({ objective: v })}
              options={OBJECTIVES}
              error={errors.objective}
              hint="What success looks like for you."
            />
          </div>

          <Field
            id="cw-brief"
            label="Description"
            textarea
            rows={6}
            value={value.brief}
            onChange={(v) => patch({ brief: v })}
            error={errors.brief}
            maxLength={2000}
            placeholder="What the product is, who it is for, and what you want the content to do. The more specific this is, the more relevant your applications will be."
          />

          <Field
            id="cw-location"
            label="Campaign location"
            value={value.location}
            onChange={(v) => patch({ location: v })}
            placeholder="India"
            hint="Where the campaign runs. Creator location is set separately, in Creator requirements."
          />
        </div>
      </SectionCard>

      <SectionCard
        title="Campaign & product images"
        description="What the creator will be making content about."
      >
        <CampaignImages
          value={value.images ?? []}
          onChange={(images) => patch({ images })}
        />
      </SectionCard>

      <SectionCard title="Tags" description="How creators find this campaign in search.">
        <SubGroup title="Pick the ones that fit" hint="Optional, but campaigns with tags get found more often.">
          <ChipGroup
            label=""
            options={CATEGORIES}
            selected={value.tags ?? []}
            onToggle={toggleTag}
            capitalize={false}
          />
        </SubGroup>
      </SectionCard>
    </div>
  );
}